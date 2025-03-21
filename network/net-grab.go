package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type PingStats struct {
	PacketsSent     int       `json:"packets_sent"`
	PacketsReceived int       `json:"packets_received"`
	PacketLoss      float64   `json:"packet_loss"`
	MinLatency      float64   `json:"min_latency_ms"`
	MaxLatency      float64   `json:"max_latency_ms"`
	AvgLatency      float64   `json:"avg_latency_ms"`
	Jitter          float64   `json:"jitter_ms"`
	LastPingTime    time.Time `json:"last_ping_time"`
	ErrorMessage    string    `json:"error_message,omitempty"`
	latencies       []float64 `json:"-"` // Not exported to JSON
}

type PingOptions struct {
	Count    int
	Interval time.Duration
	Timeout  time.Duration
	Size     int
}

type HostInfo struct {
	IPAddress   string    `json:"ip_address"`
	Hostname    string    `json:"hostname,omitempty"`
	IsReachable bool      `json:"is_reachable"`
	PingStats   PingStats `json:"ping_stats"`
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

	// Detailed ping
	pingStats := s.detailedPing(ip, PingOptions{
		Count:    4,
		Interval: 250 * time.Millisecond,
		Timeout:  2 * time.Second,
	})
	info.PingStats = pingStats
	info.IsReachable = pingStats.PacketsReceived > 0

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
	stats := s.detailedPing(ip, PingOptions{
		Count:    4,
		Interval: 250 * time.Millisecond,
		Timeout:  2 * time.Second,
	})
	return stats.AvgLatency
}

func (s *Scanner) detailedPing(ip string, options PingOptions) PingStats {
	if options.Count == 0 {
		options.Count = 4
	}
	if options.Interval == 0 {
		options.Interval = 250 * time.Millisecond
	}
	if options.Timeout == 0 {
		options.Timeout = 2 * time.Second
	}
	if options.Size == 0 {
		options.Size = 56 // Default ping packet size
	}

	stats := PingStats{
		PacketsSent:  options.Count,
		LastPingTime: time.Now(),
	}

	// Construct ping command with all options
	timeoutSec := int(options.Timeout.Seconds())
	if timeoutSec < 1 {
		timeoutSec = 1
	}

	// Prepare ping command arguments
	args := []string{
		"-c", strconv.Itoa(options.Count),
		"-W", strconv.Itoa(timeoutSec),
		"-i", fmt.Sprintf("%.1f", options.Interval.Seconds()),
		"-s", strconv.Itoa(options.Size),
		ip,
	}

	cmd := exec.Command("ping", args...)
	output, err := cmd.CombinedOutput()

	if err != nil {
		stats.ErrorMessage = fmt.Sprintf("Ping failed: %s", err)
		// Try to extract partial information if possible
		parsePingOutput(string(output), &stats)
		return stats
	}

	// Parse ping output for detailed statistics
	parsePingOutput(string(output), &stats)

	// Calculate jitter if we have at least 2 successful pings
	if len(stats.latencies) >= 2 {
		stats.Jitter = calculateJitter(stats.latencies)
	}

	return stats
}

func parsePingOutput(output string, stats *PingStats) {
	// Initialize latencies slice
	latencies := []float64{}

	// Extract packet statistics
	packetStatsRegex := regexp.MustCompile(`(\d+) packets transmitted, (\d+) received, ([\d.]+)% packet loss`)
	matches := packetStatsRegex.FindStringSubmatch(output)
	if len(matches) >= 4 {
		stats.PacketsSent, _ = strconv.Atoi(matches[1])
		stats.PacketsReceived, _ = strconv.Atoi(matches[2])
		stats.PacketLoss, _ = strconv.ParseFloat(matches[3], 64)
	}

	// Extract latency statistics
	latencyStatsRegex := regexp.MustCompile(`min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+) ms`)
	matches = latencyStatsRegex.FindStringSubmatch(output)
	if len(matches) >= 5 {
		stats.MinLatency, _ = strconv.ParseFloat(matches[1], 64)
		stats.AvgLatency, _ = strconv.ParseFloat(matches[2], 64)
		stats.MaxLatency, _ = strconv.ParseFloat(matches[3], 64)
		// mdev (mean deviation) is similar to jitter in matches[4]
		stats.Jitter, _ = strconv.ParseFloat(matches[4], 64)
	}

	// Extract individual ping latencies
	pingLineRegex := regexp.MustCompile(`time=([\d.]+) ms`)
	for _, line := range strings.Split(output, "\n") {
		matches := pingLineRegex.FindStringSubmatch(line)
		if len(matches) >= 2 {
			latency, _ := strconv.ParseFloat(matches[1], 64)
			latencies = append(latencies, latency)
		}
	}

	// If we have latencies but couldn't parse the summary stats
	if len(latencies) > 0 && stats.PacketsReceived == 0 {
		stats.PacketsReceived = len(latencies)
		stats.PacketLoss = float64(stats.PacketsSent-stats.PacketsReceived) / float64(stats.PacketsSent) * 100

		// Calculate min, max, and average if not already done
		if stats.MinLatency == 0 && stats.MaxLatency == 0 && stats.AvgLatency == 0 {
			calculateLatencyStats(latencies, stats)
		}
	}

	// Temporarily store latencies for jitter calculation
	stats.latencies = latencies
}

func calculateLatencyStats(latencies []float64, stats *PingStats) {
	if len(latencies) == 0 {
		return
	}

	stats.MinLatency = latencies[0]
	stats.MaxLatency = latencies[0]
	sum := latencies[0]

	for _, lat := range latencies[1:] {
		sum += lat
		if lat < stats.MinLatency {
			stats.MinLatency = lat
		}
		if lat > stats.MaxLatency {
			stats.MaxLatency = lat
		}
	}

	stats.AvgLatency = sum / float64(len(latencies))
}

func calculateJitter(latencies []float64) float64 {
	if len(latencies) < 2 {
		return 0
	}

	var jitterSum float64
	for i := 1; i < len(latencies); i++ {
		jitterSum += math.Abs(latencies[i] - latencies[i-1])
	}

	return jitterSum / float64(len(latencies)-1)
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
