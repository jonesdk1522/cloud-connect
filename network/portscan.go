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

type PortResult struct {
	Port      int     `json:"port"`
	Open      bool    `json:"open"`
	Service   string  `json:"service,omitempty"`
	Banner    string  `json:"banner,omitempty"`
	LatencyMs float64 `json:"latencyMs"`
}

type ScanResult struct {
	TargetIP     string       `json:"targetIp"`
	OpenPorts    []PortResult `json:"openPorts"`
	ClosedPorts  []PortResult `json:"closedPorts,omitempty"`
	ScanTime     int64        `json:"scanTimeMs"`
	PortsScanned int          `json:"portsScanned"`
}

// Common service port map
var commonServices = map[int]string{
	21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
	80: "HTTP", 110: "POP3", 143: "IMAP", 443: "HTTPS", 465: "SMTPS",
	587: "SMTP Submission", 993: "IMAPS", 995: "POP3S", 3306: "MySQL",
	3389: "RDP", 5432: "PostgreSQL", 8080: "HTTP-Alt", 8443: "HTTPS-Alt",
}

func scanPortWithContext(ctx context.Context, ip string, port int, timeout time.Duration) PortResult {
	var dialer net.Dialer
	start := time.Now()

	address := fmt.Sprintf("%s:%d", ip, port)
	conn, err := dialer.DialContext(ctx, "tcp", address)
	latency := time.Since(start).Seconds() * 1000 // milliseconds

	result := PortResult{
		Port:      port,
		Open:      err == nil,
		LatencyMs: float64(int(latency*100)) / 100, // Round to 2 decimal places
	}

	// If open, try to identify service
	if err == nil {
		defer conn.Close()

		// Try to get a service name
		if service, ok := commonServices[port]; ok {
			result.Service = service
		}

		// Some protocols return banners upon connection
		if result.Open {
			// Set a read deadline instead of using context for the read operation
			err := conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
			if err == nil {
				banner := make([]byte, 1024)
				n, _ := conn.Read(banner)
				if n > 0 {
					result.Banner = strings.TrimSpace(string(banner[:n]))
					// Truncate if too long
					if len(result.Banner) > 100 {
						result.Banner = result.Banner[:97] + "..."
					}
				}
			}
		}
	}

	return result
}

func scanPortsWithRateLimit(ip string, ports []int, timeout time.Duration, maxConcurrent int) ScanResult {
	startTime := time.Now()

	ctx, cancel := context.WithTimeout(context.Background(), timeout+5*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	resultChan := make(chan PortResult, len(ports))

	// Create a semaphore channel to limit concurrency
	semaphore := make(chan struct{}, maxConcurrent)

	// Launch scanning goroutines with rate limiting
	for _, port := range ports {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()

			// Acquire semaphore
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			portCtx, portCancel := context.WithTimeout(ctx, timeout)
			defer portCancel()

			result := scanPortWithContext(portCtx, ip, p, timeout)
			resultChan <- result
		}(port)
	}

	// Close results channel when all goroutines complete
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	var openPorts []PortResult
	var closedPorts []PortResult

	for result := range resultChan {
		if result.Open {
			openPorts = append(openPorts, result)
		} else {
			closedPorts = append(closedPorts, result)
		}
	}

	scanTime := time.Since(startTime).Milliseconds()

	return ScanResult{
		TargetIP:     ip,
		OpenPorts:    openPorts,
		ClosedPorts:  closedPorts,
		ScanTime:     scanTime,
		PortsScanned: len(ports),
	}
}

// parsePortRange parses inputs like "80,443", "1-1000", or "22,80-90,443"
func parsePortRange(portsArg string) ([]int, error) {
	var ports []int
	rangeStrings := strings.Split(portsArg, ",")

	for _, rs := range rangeStrings {
		rs = strings.TrimSpace(rs)
		if strings.Contains(rs, "-") {
			rangeParts := strings.Split(rs, "-")
			if len(rangeParts) != 2 {
				return nil, fmt.Errorf("invalid port range: %s", rs)
			}

			start, err := strconv.Atoi(rangeParts[0])
			if err != nil {
				return nil, fmt.Errorf("invalid start port: %s", rangeParts[0])
			}

			end, err := strconv.Atoi(rangeParts[1])
			if err != nil {
				return nil, fmt.Errorf("invalid end port: %s", rangeParts[1])
			}

			if start > end || start < 1 || end > 65535 {
				return nil, fmt.Errorf("invalid port range: %s (must be 1-65535)", rs)
			}

			for port := start; port <= end; port++ {
				ports = append(ports, port)
			}
		} else {
			port, err := strconv.Atoi(rs)
			if err != nil {
				return nil, fmt.Errorf("invalid port: %s", rs)
			}

			if port < 1 || port > 65535 {
				return nil, fmt.Errorf("port must be between 1 and 65535: %d", port)
			}

			ports = append(ports, port)
		}
	}

	return ports, nil
}

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: portscan <targetIP> <portRange> [timeout] [maxConcurrent]")
		fmt.Println("Examples:")
		fmt.Println("  portscan 8.8.8.8 80,443")
		fmt.Println("  portscan 192.168.1.1 1-1000 5 100")
		os.Exit(1)
	}

	targetIP := os.Args[1]
	portRangeStr := os.Args[2]

	timeout := 2 * time.Second
	if len(os.Args) >= 4 {
		if timeoutSecs, err := strconv.Atoi(os.Args[3]); err == nil {
			timeout = time.Duration(timeoutSecs) * time.Second
		}
	}

	maxConcurrent := 100
	if len(os.Args) >= 5 {
		if mc, err := strconv.Atoi(os.Args[4]); err == nil && mc > 0 {
			maxConcurrent = mc
		}
	}

	ports, err := parsePortRange(portRangeStr)
	if err != nil {
		fmt.Printf("{\"error\": \"%s\"}\n", err.Error())
		os.Exit(1)
	}

	if len(ports) == 0 {
		fmt.Printf("{\"error\": \"No valid ports specified\"}\n")
		os.Exit(1)
	}

	if len(ports) > 10000 && maxConcurrent > 500 {
		// Prevent too aggressive scanning
		maxConcurrent = 500
	}

	result := scanPortsWithRateLimit(targetIP, ports, timeout, maxConcurrent)

	jsonResult, _ := json.Marshal(result)
	fmt.Println(string(jsonResult))
}
