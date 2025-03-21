package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type HostInfo struct {
	IPAddress   string    `json:"ip_address"`
	Hostname    string    `json:"hostname,omitempty"`
	IsReachable bool      `json:"is_reachable"`
	LatencyMs   float64   `json:"latency_ms,omitempty"`
	OpenPorts   []int     `json:"open_ports,omitempty"`
	DNSNames    []string  `json:"dns_names,omitempty"`
	ScannedAt   time.Time `json:"scanned_at"`
}

type Scanner struct {
	ports    []int
	timeout  time.Duration
	maxHosts int
	results  []HostInfo
	mu       sync.Mutex
}

func NewScanner() *Scanner {
	return &Scanner{
		ports:    []int{22, 80, 443, 3389, 8080}, // Common ports
		timeout:  time.Second * 2,
		maxHosts: 256,
	}
}

func (s *Scanner) scanNetwork(cidr string) error {
	ip, ipnet, err := net.ParseCIDR(cidr)
	if err != nil {
		return err
	}

	var hosts []string
	for ip := ip.Mask(ipnet.Mask); ipnet.Contains(ip); inc(ip) {
		hosts = append(hosts, ip.String())
		if len(hosts) >= s.maxHosts {
			break
		}
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, 20) // Limit concurrent scans

	for _, host := range hosts {
		wg.Add(1)
		sem <- struct{}{}

		go func(ip string) {
			defer wg.Done()
			defer func() { <-sem }()

			info := s.scanHost(ip)

			s.mu.Lock()
			s.results = append(s.results, info)
			s.mu.Unlock()
		}(host)
	}

	wg.Wait()
	return nil
}

func (s *Scanner) scanHost(ip string) HostInfo {
	info := HostInfo{
		IPAddress: ip,
		ScannedAt: time.Now(),
	}

	// Basic ping
	if latency := s.ping(ip); latency > 0 {
		info.IsReachable = true
		info.LatencyMs = latency
	}

	// DNS lookup
	if names, err := net.LookupAddr(ip); err == nil {
		info.DNSNames = names
		if len(names) > 0 {
			info.Hostname = strings.TrimSuffix(names[0], ".")
		}
	}

	// Port scan
	if info.IsReachable {
		info.OpenPorts = s.scanPorts(ip)
	}

	return info
}

func (s *Scanner) ping(ip string) float64 {
	cmd := exec.Command("ping", "-c", "1", "-W", "2", ip)
	start := time.Now()
	if err := cmd.Run(); err != nil {
		return 0
	}
	return float64(time.Since(start).Milliseconds())
}

func (s *Scanner) scanPorts(ip string) []int {
	var openPorts []int
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, port := range s.ports {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			address := fmt.Sprintf("%s:%d", ip, p)
			conn, err := net.DialTimeout("tcp", address, s.timeout)
			if err == nil {
				conn.Close()
				mu.Lock()
				openPorts = append(openPorts, p)
				mu.Unlock()
			}
		}(port)
	}

	wg.Wait()
	return openPorts
}

// Helper to increment IP address
func inc(ip net.IP) {
	for j := len(ip) - 1; j >= 0; j-- {
		ip[j]++
		if ip[j] > 0 {
			break
		}
	}
}

func main() {
	if len(os.Args) != 2 {
		fmt.Println("Usage: net-grab <cidr>")
		fmt.Println("Example: net-grab 192.168.1.0/24")
		os.Exit(1)
	}

	scanner := NewScanner()
	if err := scanner.scanNetwork(os.Args[1]); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	json.NewEncoder(os.Stdout).Encode(scanner.results)
}
