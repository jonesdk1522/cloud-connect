package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type DNSResult struct {
	Domain      string   `json:"domain"`
	IPv4        []string `json:"ipv4,omitempty"`
	IPv6        []string `json:"ipv6,omitempty"`
	CNAME       []string `json:"cname,omitempty"`
	MX          []string `json:"mx,omitempty"`
	NS          []string `json:"ns,omitempty"`
	TXT         []string `json:"txt,omitempty"`
	Error       string   `json:"error,omitempty"`
	ResolveTime int64    `json:"resolveTimeMs"`
}

type MultipleDNSResult struct {
	Results    []DNSResult `json:"results"`
	TotalTime  int64       `json:"totalTimeMs"`
	Successful int         `json:"successful"`
	Failed     int         `json:"failed"`
}

func lookupDNS(ctx context.Context, domain string, queryTypes []string, dnsServer string) DNSResult {
	startTime := time.Now()

	var resolver *net.Resolver
	if dnsServer != "" {
		resolver = &net.Resolver{
			PreferGo: true,
			Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
				d := net.Dialer{Timeout: 10 * time.Second}
				return d.DialContext(ctx, "udp", dnsServer+":53")
			},
		}
	} else {
		resolver = net.DefaultResolver
	}

	result := DNSResult{Domain: domain}

	// Use waitgroup to run all lookups concurrently
	var wg sync.WaitGroup

	// Check if "all" is in the query types
	doAll := false
	for _, t := range queryTypes {
		if t == "all" {
			doAll = true
			break
		}
	}

	// If doAll is true, set queryTypes to include all supported types
	if doAll {
		queryTypes = []string{"a", "aaaa", "cname", "mx", "ns", "txt"}
	}

	// Create a mutex to protect result modifications
	var mu sync.Mutex

	for _, queryType := range queryTypes {
		wg.Add(1)

		go func(qtype string) {
			defer wg.Done()

			switch strings.ToLower(qtype) {
			case "a":
				ips, err := resolver.LookupIP(ctx, "ip4", domain)
				if err == nil {
					ipStrings := make([]string, 0, len(ips))
					for _, ip := range ips {
						ipStrings = append(ipStrings, ip.String())
					}
					mu.Lock()
					result.IPv4 = ipStrings
					mu.Unlock()
				}

			case "aaaa":
				ips, err := resolver.LookupIP(ctx, "ip6", domain)
				if err == nil {
					ipStrings := make([]string, 0, len(ips))
					for _, ip := range ips {
						ipStrings = append(ipStrings, ip.String())
					}
					mu.Lock()
					result.IPv6 = ipStrings
					mu.Unlock()
				}

			case "cname":
				cname, err := resolver.LookupCNAME(ctx, domain)
				if err == nil {
					mu.Lock()
					result.CNAME = []string{cname}
					mu.Unlock()
				}

			case "mx":
				mxs, err := resolver.LookupMX(ctx, domain)
				if err == nil {
					mxStrings := make([]string, 0, len(mxs))
					for _, mx := range mxs {
						mxStrings = append(mxStrings, fmt.Sprintf("%s priority=%d", mx.Host, mx.Pref))
					}
					mu.Lock()
					result.MX = mxStrings
					mu.Unlock()
				}

			case "ns":
				nss, err := resolver.LookupNS(ctx, domain)
				if err == nil {
					nsStrings := make([]string, 0, len(nss))
					for _, ns := range nss {
						nsStrings = append(nsStrings, ns.Host)
					}
					mu.Lock()
					result.NS = nsStrings
					mu.Unlock()
				}

			case "txt":
				txts, err := resolver.LookupTXT(ctx, domain)
				if err == nil {
					mu.Lock()
					result.TXT = txts
					mu.Unlock()
				}
			}
		}(queryType)
	}

	wg.Wait()
	result.ResolveTime = time.Since(startTime).Milliseconds()
	return result
}

func lookupMultipleDomains(domains []string, queryTypes []string, dnsServer string, timeout int) MultipleDNSResult {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	startTime := time.Now()

	var wg sync.WaitGroup
	results := make([]DNSResult, len(domains))

	for i, domain := range domains {
		wg.Add(1)
		go func(index int, d string) {
			defer wg.Done()
			results[index] = lookupDNS(ctx, d, queryTypes, dnsServer)
		}(i, domain)
	}

	wg.Wait()

	totalTime := time.Since(startTime).Milliseconds()

	// Count successes and failures
	successful := 0
	failed := 0

	for _, r := range results {
		if r.Error == "" && (len(r.IPv4) > 0 || len(r.IPv6) > 0 || len(r.CNAME) > 0 ||
			len(r.MX) > 0 || len(r.NS) > 0 || len(r.TXT) > 0) {
			successful++
		} else {
			failed++
		}
	}

	return MultipleDNSResult{
		Results:    results,
		TotalTime:  totalTime,
		Successful: successful,
		Failed:     failed,
	}
}

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: dns <domain1[,domain2,...]> <type1[,type2,...]> [server] [timeout]")
		fmt.Println("Types: a, aaaa, cname, mx, ns, txt, all")
		fmt.Println("Examples:")
		fmt.Println("  dns google.com all")
		fmt.Println("  dns google.com,cloudflare.com a,aaaa 8.8.8.8 5")
		os.Exit(1)
	}

	domainsArg := os.Args[1]
	domains := strings.Split(domainsArg, ",")

	typesArg := os.Args[2]
	queryTypes := strings.Split(typesArg, ",")

	dnsServer := ""
	if len(os.Args) >= 4 {
		dnsServer = os.Args[3]
	}

	timeout := 10
	if len(os.Args) >= 5 {
		if t, err := strconv.Atoi(os.Args[4]); err == nil && t > 0 {
			timeout = t
		}
	}

	var jsonResult []byte

	if len(domains) == 1 {
		// Single domain
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
		defer cancel()

		result := lookupDNS(ctx, domains[0], queryTypes, dnsServer)
		jsonResult, _ = json.Marshal(result)
	} else {
		// Multiple domains
		results := lookupMultipleDomains(domains, queryTypes, dnsServer, timeout)
		jsonResult, _ = json.Marshal(results)
	}

	fmt.Println(string(jsonResult))
}
