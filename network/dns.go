package main

import (
    "context"
    "encoding/json"
    "fmt"
    "net"
    "os"
    "strings"
    "time"
)

type DNSResult struct {
    Domain     string   `json:"domain"`
    IPv4       []string `json:"ipv4,omitempty"`
    IPv6       []string `json:"ipv6,omitempty"`
    CNAME      []string `json:"cname,omitempty"`
    MX         []string `json:"mx,omitempty"`
    NS         []string `json:"ns,omitempty"`
    TXT        []string `json:"txt,omitempty"`
    Error      string   `json:"error,omitempty"`
    ResolveTime int64   `json:"resolveTimeMs"`
}

func main() {
    if len(os.Args) < 3 {
        fmt.Println("Usage: dns <domain> <type> [server]")
        fmt.Println("Types: a, aaaa, cname, mx, ns, txt, all")
        os.Exit(1)
    }
    
    domain := os.Args[1]
    queryType := strings.ToLower(os.Args[2])
    
    var resolver *net.Resolver
    if len(os.Args) >= 4 {
        dnsServer := os.Args[3]
        resolver = &net.Resolver{
            PreferGo: true,
            Dial: func(ctx net.Context, network, address string) (net.Conn, error) {
                d := net.Dialer{Timeout: 10 * time.Second}
                return d.DialContext(ctx, "udp", dnsServer+":53")
            },
        }
    } else {
        resolver = net.DefaultResolver
    }
    
    result := DNSResult{Domain: domain}
    startTime := time.Now()
    
    ctx := context.Background()
    
    if queryType == "a" || queryType == "all" {
        ips, err := resolver.LookupIP(ctx, "ip4", domain)
        if err == nil {
            for _, ip := range ips {
                result.IPv4 = append(result.IPv4, ip.String())
            }
        }
    }
    
    if queryType == "aaaa" || queryType == "all" {
        ips, err := resolver.LookupIP(ctx, "ip6", domain)
        if err == nil {
            for _, ip := range ips {
                result.IPv6 = append(result.IPv6, ip.String())
            }
        }
    }
    
    if queryType == "cname" || queryType == "all" {
        cname, err := resolver.LookupCNAME(ctx, domain)
        if err == nil {
            result.CNAME = append(result.CNAME, cname)
        }
    }
    
    if queryType == "mx" || queryType == "all" {
        mxs, err := resolver.LookupMX(ctx, domain)
        if err == nil {
            for _, mx := range mxs {
                result.MX = append(result.MX, fmt.Sprintf("%s priority=%d", mx.Host, mx.Pref))
            }
        }
    }
    
    if queryType == "ns" || queryType == "all" {
        nss, err := resolver.LookupNS(ctx, domain)
        if err == nil {
            for _, ns := range nss {
                result.NS = append(result.NS, ns.Host)
            }
        }
    }
    
    if queryType == "txt" || queryType == "all" {
        txts, err := resolver.LookupTXT(ctx, domain)
        if err == nil {
            result.TXT = txts
        }
    }
    
    result.ResolveTime = time.Since(startTime).Milliseconds()
    
    jsonResult, _ := json.Marshal(result)
    fmt.Println(string(jsonResult))
}