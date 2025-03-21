package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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
	ports         []int
	timeout       time.Duration
	maxHosts      int
	results       []HostInfo
	mu            sync.Mutex
	verbose       bool
	liveDisplay   bool
	hostsScanned  int32 // Atomic counter for progress tracking
	totalHosts    int   // Total hosts to be scanned
	progressMutex sync.Mutex
}

func NewScanner(verbose, liveDisplay bool) *Scanner {
	return &Scanner{
		ports:       []int{22, 80, 443, 3389, 8080}, // Common ports
		timeout:     time.Second * 2,
		maxHosts:    256,
		verbose:     verbose,
		liveDisplay: liveDisplay,
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

	s.totalHosts = len(hosts)
	if s.liveDisplay {
		fmt.Printf("Starting scan of %d hosts in %s\n", s.totalHosts, cidr)
		// Start a goroutine to display progress
		go s.displayProgress()
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

			if s.liveDisplay {
				s.displayHostResult(info)
			}

			// Update progress counter
			atomic.AddInt32(&s.hostsScanned, 1)
		}(host)
	}

	wg.Wait()
	
	if s.liveDisplay {
		fmt.Printf("\nScan complete. %d hosts scanned.\n", s.totalHosts)
	}
	
	return nil
}

// Displays live progress of the scan
func (s *Scanner) displayProgress() {
	for {
		scanned := atomic.LoadInt32(&s.hostsScanned)
		if scanned >= int32(s.totalHosts) {
			break
		}

		percentage := float64(scanned) / float64(s.totalHosts) * 100
		fmt.Printf("\rProgress: %.1f%% (%d/%d hosts scanned)", percentage, scanned, s.totalHosts)
		time.Sleep(500 * time.Millisecond)
	}
}

// Displays detailed host result during live scanning
func (s *Scanner) displayHostResult(info HostInfo) {
	if !s.verbose {
		// In non-verbose mode, just show basic information
		status := "✓"
		if !info.IsReachable {
			status = "✗"
		}
		
		s.progressMutex.Lock()
		fmt.Printf("\r\n%s %s", status, info.IPAddress)
		if info.Hostname != "" {
			fmt.Printf(" (%s)", info.Hostname)
		}
		fmt.Printf(" - %d open ports", len(info.OpenPorts))
		s.progressMutex.Unlock()
		return
	}
	
	// Verbose mode shows detailed ping results
	s.progressMutex.Lock()
	defer s.progressMutex.Unlock()
	
	fmt.Printf("\r\n==========================================\n")
	fmt.Printf("Host: %s\n", info.IPAddress)
	if info.Hostname != "" {
		fmt.Printf("Hostname: %s\n", info.Hostname)
	}
	fmt.Printf("Status: %s\n", statusText(info.IsReachable))
	
	// Detailed ping statistics
	fmt.Printf("\nPing Statistics:\n")
	fmt.Printf("  Packets: %d sent, %d received, %.1f%% loss\n", 
		info.PingStats.PacketsSent, 
		info.PingStats.PacketsReceived,
		info.PingStats.PacketLoss)
	
	if info.PingStats.PacketsReceived > 0 {
		fmt.Printf("  Latency: %.2f ms min, %.2f ms avg, %.2f ms max\n",
			info.PingStats.MinLatency,
			info.PingStats.AvgLatency,
			info.PingStats.MaxLatency)
		fmt.Printf("  Jitter: %.2f ms\n", info.PingStats.Jitter)
	}
	
	if len(info.OpenPorts) > 0 {
		fmt.Printf("\nOpen Ports: %v\n", formatPorts(info.OpenPorts))
	}
	
	if info.PingStats.ErrorMessage != "" {
		fmt.Printf("\nError: %s\n", info.PingStats.ErrorMessage)
	}
	
	fmt.Printf("==========================================\n")
}

func statusText(reachable bool) string {
	if reachable {
		return "Reachable"
	}
	return "Unreachable"
}

func formatPorts(ports []int) string {
	var portStrings []string
	for _, port := range ports {
		service := getServiceName(port)
		if service != "" {
			portStrings = append(portStrings, fmt.Sprintf("%d (%s)", port, service))
		} else {
			portStrings = append(portStrings, fmt.Sprintf("%d", port))
		}
	}
	return strings.Join(portStrings, ", ")
}

// Returns common service names for well-known ports
func getServiceName(port int) string {
	switch port {
	case 22:
		return "SSH"
	case 80:
		return "HTTP"
	case 443:
		return "HTTPS"
	case 3389:
		return "RDP"
	case 8080:
		return "HTTP-Alt"
	default:
		return ""
	}
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
	// Parse command-line flags
	verbose := flag.Bool("v", false, "Enable verbose output")
	live := flag.Bool("live", false, "Show live scanning results")
	jsonOutput := flag.Bool("json", false, "Output results as JSON (default)")
	flag.Parse()
	
	// Enable live display if verbose is enabled
	if *verbose {
		*live = true
	}
	
	args := flag.Args()
	if len(args) != 1 {
		fmt.Println("Usage: net-grab [options] <cidr>")
		fmt.Println("Example: net-grab -v 192.168.1.0/24")
		fmt.Println("\nOptions:")
		flag.PrintDefaults()
		os.Exit(1)
	}
	
	scanner := NewScanner(*verbose, *live)
	if err := scanner.scanNetwork(args[0]); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	
	// Output results as JSON if not in live mode or if explicitly requested
	if !*live || *jsonOutput {
		json.NewEncoder(os.Stdout).Encode(scanner.results)
	}
}
