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
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Add color constants at the top of the file
const (
	ColorReset  = "\033[0m"
	ColorRed    = "\033[31m"
	ColorGreen  = "\033[32m"
	ColorYellow = "\033[33m"
	ColorBlue   = "\033[34m"
	ColorPurple = "\033[35m"
	ColorCyan   = "\033[36m"
	ColorGray   = "\033[37m"
	MaxPort     = 65535
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

type PortScanOptions struct {
	Ports     []int
	StartPort int
	EndPort   int
	ScanAll   bool
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
	portOptions   PortScanOptions
}

func NewScanner(verbose, liveDisplay bool) *Scanner {
	return &Scanner{
		ports:       []int{22, 80, 443, 3389, 8080}, // Common ports
		timeout:     time.Second * 2,
		maxHosts:    256,
		verbose:     verbose,
		liveDisplay: liveDisplay,
		portOptions: PortScanOptions{
			StartPort: 1,
			EndPort:   MaxPort,
		},
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

// Update displayProgress with color
func (s *Scanner) displayProgress() {
	for {
		scanned := atomic.LoadInt32(&s.hostsScanned)
		if scanned >= int32(s.totalHosts) {
			break
		}

		percentage := float64(scanned) / float64(s.totalHosts) * 100
		fmt.Printf("\r%sProgress: %s%.1f%% (%d/%d hosts scanned)%s",
			ColorBlue,
			ColorYellow,
			percentage,
			scanned,
			s.totalHosts,
			ColorReset)
		time.Sleep(500 * time.Millisecond)
	}
}

// Update displayHostResult with color
func (s *Scanner) displayHostResult(info HostInfo) {
	if !s.verbose {
		status := ColorGreen + "✓" + ColorReset
		if !info.IsReachable {
			status = ColorRed + "✗" + ColorReset
		}

		s.progressMutex.Lock()
		fmt.Printf("\r\n%s %s%s%s",
			status,
			ColorCyan,
			info.IPAddress,
			ColorReset)
		if info.Hostname != "" {
			fmt.Printf(" (%s%s%s)", ColorYellow, info.Hostname, ColorReset)
		}
		fmt.Printf(" - %s%d open ports%s", ColorPurple, len(info.OpenPorts), ColorReset)
		s.progressMutex.Unlock()
		return
	}

	s.progressMutex.Lock()
	defer s.progressMutex.Unlock()

	fmt.Printf("\r\n%s===========================================%s\n", ColorBlue, ColorReset)
	fmt.Printf("%sHost:%s %s%s%s\n", ColorGray, ColorReset, ColorCyan, info.IPAddress, ColorReset)
	if info.Hostname != "" {
		fmt.Printf("%sHostname:%s %s%s%s\n", ColorGray, ColorReset, ColorYellow, info.Hostname, ColorReset)
	}
	fmt.Printf("%sStatus:%s %s\n", ColorGray, ColorReset, colorStatus(info.IsReachable))

	fmt.Printf("\n%sPing Statistics:%s\n", ColorBlue, ColorReset)
	fmt.Printf("  %sPackets:%s %d sent, %d received, %.1f%% loss\n",
		ColorGray,
		ColorReset,
		info.PingStats.PacketsSent,
		info.PingStats.PacketsReceived,
		info.PingStats.PacketLoss)

	if info.PingStats.PacketsReceived > 0 {
		fmt.Printf("  %sLatency:%s %.2f ms min, %.2f ms avg, %.2f ms max\n",
			ColorGray,
			ColorReset,
			info.PingStats.MinLatency,
			info.PingStats.AvgLatency,
			info.PingStats.MaxLatency)
		fmt.Printf("  %sJitter:%s %.2f ms\n", ColorGray, ColorReset, info.PingStats.Jitter)
	}

	if len(info.OpenPorts) > 0 {
		fmt.Printf("\n%sOpen Ports:%s %s%v%s\n",
			ColorBlue,
			ColorReset,
			ColorPurple,
			formatPorts(info.OpenPorts),
			ColorReset)
	}

	if info.PingStats.ErrorMessage != "" {
		fmt.Printf("\n%sError:%s %s%s%s\n",
			ColorRed,
			ColorReset,
			ColorRed,
			info.PingStats.ErrorMessage,
			ColorReset)
	}

	fmt.Printf("%s===========================================%s\n", ColorBlue, ColorReset)
}

func colorStatus(reachable bool) string {
	if reachable {
		return ColorGreen + "Reachable" + ColorReset
	}
	return ColorRed + "Unreachable" + ColorReset
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
	var portsToScan []int

	if len(s.portOptions.Ports) > 0 {
		portsToScan = s.portOptions.Ports
	} else if s.portOptions.ScanAll {
		// Generate range for all ports
		for i := s.portOptions.StartPort; i <= s.portOptions.EndPort; i++ {
			portsToScan = append(portsToScan, i)
		}
	} else {
		// Generate range for specified port range
		for i := s.portOptions.StartPort; i <= s.portOptions.EndPort; i++ {
			portsToScan = append(portsToScan, i)
		}
	}

	var openPorts []int
	var mu sync.Mutex
	var wg sync.WaitGroup

	// Adjust concurrent connections based on port range
	maxConcurrent := 500
	if len(portsToScan) > 10000 {
		maxConcurrent = 200 // Reduce concurrency for large scans
	}
	sem := make(chan struct{}, maxConcurrent)

	// Add progress tracking for port scanning
	var scannedPorts int32
	totalPorts := len(portsToScan)

	// Start progress display goroutine for large scans
	if totalPorts > 1000 {
		go func() {
			for {
				current := atomic.LoadInt32(&scannedPorts)
				if current >= int32(totalPorts) {
					break
				}
				percentage := float64(current) / float64(totalPorts) * 100
				fmt.Printf("\r%sScanning ports: %.1f%% (%d/%d)%s",
					ColorYellow,
					percentage,
					current,
					totalPorts,
					ColorReset)
				time.Sleep(500 * time.Millisecond)
			}
			fmt.Println()
		}()
	}

	// Break ports into chunks for better management
	chunkSize := 1000
	for i := 0; i < len(portsToScan); i += chunkSize {
		end := i + chunkSize
		if end > len(portsToScan) {
			end = len(portsToScan)
		}
		chunk := portsToScan[i:end]

		for _, port := range chunk {
			wg.Add(1)
			sem <- struct{}{} // Acquire semaphore

			go func(p int) {
				defer wg.Done()
				defer func() { <-sem }() // Release semaphore

				address := fmt.Sprintf("%s:%d", ip, p)
				conn, err := net.DialTimeout("tcp", address, s.timeout)
				if err == nil {
					conn.Close()
					mu.Lock()
					openPorts = append(openPorts, p)
					mu.Unlock()
				}

				atomic.AddInt32(&scannedPorts, 1)
			}(port)
		}

		// Wait for current chunk to complete before starting next
		wg.Wait()
	}

	// Sort the open ports before returning
	sort.Ints(openPorts)
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

// Update formatHostResult with color
func formatHostResult(info HostInfo) string {
	var result strings.Builder

	status := ColorGreen + "✓" + ColorReset
	if !info.IsReachable {
		status = ColorRed + "✗" + ColorReset
	}

	fmt.Fprintf(&result, "\n%s %s%s%s",
		status,
		ColorCyan,
		info.IPAddress,
		ColorReset)
	if info.Hostname != "" {
		fmt.Fprintf(&result, " (%s%s%s)", ColorYellow, info.Hostname, ColorReset)
	}

	if info.PingStats.PacketsReceived > 0 {
		fmt.Fprintf(&result, "\n  %sLatency:%s %.1fms min / %.1fms avg / %.1fms max",
			ColorGray,
			ColorReset,
			info.PingStats.MinLatency,
			info.PingStats.AvgLatency,
			info.PingStats.MaxLatency)
		fmt.Fprintf(&result, "\n  %sPacket Loss:%s %.1f%% (%d/%d)",
			ColorGray,
			ColorReset,
			info.PingStats.PacketLoss,
			info.PingStats.PacketsReceived,
			info.PingStats.PacketsSent)
	}

	if len(info.OpenPorts) > 0 {
		fmt.Fprintf(&result, "\n  %sOpen Ports:%s %s%s%s",
			ColorBlue,
			ColorReset,
			ColorPurple,
			formatColoredPorts(info.OpenPorts),
			ColorReset)
	}

	return result.String()
}

func formatColoredPorts(ports []int) string {
	var portStrings []string
	for _, port := range ports {
		service := getServiceName(port)
		if service != "" {
			portStrings = append(portStrings, fmt.Sprintf("%d (%s%s%s)",
				port,
				ColorCyan,
				service,
				ColorPurple))
		} else {
			portStrings = append(portStrings, fmt.Sprintf("%d", port))
		}
	}
	return strings.Join(portStrings, ", ")
}

func parsePortSpec(spec string) (PortScanOptions, error) {
	opts := PortScanOptions{}

	// Handle "all" keyword
	if strings.ToLower(spec) == "all" {
		opts.ScanAll = true
		opts.StartPort = 1
		opts.EndPort = MaxPort
		return opts, nil
	}

	// Handle comma-separated list
	if strings.Contains(spec, ",") {
		ports := []int{}
		for _, p := range strings.Split(spec, ",") {
			port, err := strconv.Atoi(strings.TrimSpace(p))
			if err != nil || port < 1 || port > MaxPort {
				return opts, fmt.Errorf("invalid port: %s", p)
			}
			ports = append(ports, port)
		}
		opts.Ports = ports
		return opts, nil
	}

	// Handle port range (e.g., "80-100")
	if strings.Contains(spec, "-") {
		parts := strings.Split(spec, "-")
		if len(parts) != 2 {
			return opts, fmt.Errorf("invalid port range: %s", spec)
		}

		start, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil || start < 1 || start > MaxPort {
			return opts, fmt.Errorf("invalid start port: %s", parts[0])
		}

		end, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil || end < 1 || end > MaxPort {
			return opts, fmt.Errorf("invalid end port: %s", parts[1])
		}

		if start > end {
			start, end = end, start
		}

		opts.StartPort = start
		opts.EndPort = end
		return opts, nil
	}

	// Handle single port
	port, err := strconv.Atoi(spec)
	if err != nil || port < 1 || port > MaxPort {
		return opts, fmt.Errorf("invalid port: %s", spec)
	}
	opts.Ports = []int{port}
	return opts, nil
}

func main() {
	verbose := flag.Bool("v", true, "Enable verbose output")      // Default to true
	live := flag.Bool("live", true, "Show live scanning results") // Default to true
	jsonOutput := flag.Bool("json", false, "Output results as JSON")
	portSpec := flag.String("p", "22,80,443,3389,8080", "Port specification (e.g., '80', '80,443', '1-1000', 'all')")
	flag.Parse()

	args := flag.Args()
	if len(args) != 1 {
		fmt.Println("Usage: net-grab [options] <cidr>")
		fmt.Println("Example: net-grab 192.168.1.0/24")
		fmt.Println("\nOptions:")
		flag.PrintDefaults()
		os.Exit(1)
	}

	fmt.Printf("Starting network scan of %s...\n", args[0])

	scanner := NewScanner(*verbose, *live)

	// Parse port specification
	portOpts, err := parsePortSpec(*portSpec)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%sError:%s %v\n", ColorRed, ColorReset, err)
		os.Exit(1)
	}
	scanner.portOptions = portOpts

	if err := scanner.scanNetwork(args[0]); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Always show a summary
	fmt.Printf("\nScan Summary:\n")
	fmt.Printf("Total hosts scanned: %d\n", len(scanner.results))

	reachable := 0
	for _, host := range scanner.results {
		if host.IsReachable {
			reachable++
		}
	}

	fmt.Printf("Hosts responding: %d\n", reachable)

	// Output detailed results
	if *jsonOutput {
		json.NewEncoder(os.Stdout).Encode(scanner.results)
	} else {
		fmt.Println("\nDetailed Results:")
		for _, host := range scanner.results {
			fmt.Println(formatHostResult(host))
		}
	}
}
