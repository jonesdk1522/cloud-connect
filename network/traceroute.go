package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type HopResult struct {
	HopNumber int       `json:"hop"`
	Address   string    `json:"address"`
	Hostname  string    `json:"hostname,omitempty"`
	RTT       float64   `json:"rttMs"`
	LossRate  float64   `json:"lossRate,omitempty"` // Percentage of packet loss
	TimedOut  bool      `json:"timedOut,omitempty"`
	AllRTTs   []float64 `json:"allRttMs,omitempty"` // All individual RTT values
}

type TracerouteResult struct {
	TargetIP    string      `json:"targetIp"`
	TargetName  string      `json:"targetName,omitempty"`
	Hops        []HopResult `json:"hops"`
	Success     bool        `json:"success"`
	TotalHops   int         `json:"totalHops"`
	ElapsedTime int64       `json:"elapsedTimeMs"`
	Error       string      `json:"error,omitempty"`
}

type MultiTracerouteResult struct {
	Results    []TracerouteResult `json:"results"`
	TotalTime  int64              `json:"totalTimeMs"`
	Successful int                `json:"successful"`
	Failed     int                `json:"failed"`
}

// isWindows detects if running on Windows OS
func isWindows() bool {
	return os.PathSeparator == '\\' && os.PathListSeparator == ';'
}

// isDarwin detects if running on macOS
func isDarwin() bool {
	output, err := exec.Command("uname").Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) == "Darwin"
}

// runTraceroute performs a traceroute to the target with context for timeout
func runTraceroute(ctx context.Context, targetIP string, maxHops int, useNumeric bool) (TracerouteResult, error) {
	startTime := time.Now()

	var cmd *exec.Cmd
	var args []string

	if isWindows() {
		args = []string{"-h", strconv.Itoa(maxHops)}
		if useNumeric {
			args = append(args, "-d")
		}
		args = append(args, targetIP)
		cmd = exec.CommandContext(ctx, "tracert", args...)
	} else if isDarwin() {
		args = []string{"-m", strconv.Itoa(maxHops)}
		if useNumeric {
			args = append(args, "-n")
		}
		args = append(args, targetIP)
		cmd = exec.CommandContext(ctx, "traceroute", args...)
	} else {
		// Linux and others
		args = []string{"-m", strconv.Itoa(maxHops), "-q", "3", "-w", "1"}
		if useNumeric {
			args = append(args, "-n")
		}
		args = append(args, targetIP)
		cmd = exec.CommandContext(ctx, "traceroute", args...)
	}

	output, err := cmd.CombinedOutput()
	elapsedTime := time.Since(startTime).Milliseconds()

	result := TracerouteResult{
		TargetIP:    targetIP,
		ElapsedTime: elapsedTime,
	}

	// Look up hostname if we have an IP
	if net.ParseIP(targetIP) != nil {
		names, err := net.LookupAddr(targetIP)
		if err == nil && len(names) > 0 {
			result.TargetName = strings.TrimSuffix(names[0], ".")
		}
	}

	if err != nil {
		// Some traceroute errors are expected, like unreachable destinations
		result.Error = fmt.Sprintf("Traceroute error: %v", err)

		// Parse the output anyway, we may have partial results
		hops := parseTracerouteOutput(string(output))
		result.Hops = hops
		result.TotalHops = len(hops)
		result.Success = len(hops) > 0 && len(hops) < maxHops

		return result, err
	}

	hops := parseTracerouteOutput(string(output))
	result.Hops = hops
	result.TotalHops = len(hops)

	// Check if we reached the target
	success := false
	if len(hops) > 0 {
		lastHop := hops[len(hops)-1]
		if lastHop.Address == targetIP || !lastHop.TimedOut {
			success = true
		}
	}

	result.Success = success
	return result, nil
}

// parseTracerouteOutput parses the command output into structured data
func parseTracerouteOutput(output string) []HopResult {
	lines := strings.Split(output, "\n")
	var hops []HopResult

	// Skip the first line, which is usually the header
	for i := 1; i < len(lines); i++ {
		line := lines[i]

		// Skip empty lines
		if strings.TrimSpace(line) == "" {
			continue
		}

		// Parse based on OS-specific formats
		var hop HopResult

		if isWindows() {
			hop = parseWindowsTracerouteLine(line)
		} else if isDarwin() {
			hop = parseDarwinTracerouteLine(line)
		} else {
			hop = parseLinuxTracerouteLine(line)
		}

		// Only add non-zero hops
		if hop.HopNumber > 0 {
			hops = append(hops, hop)
		}
	}

	return hops
}

// parseWindowsTracerouteLine parses Windows tracert output format
func parseWindowsTracerouteLine(line string) HopResult {
	// Windows format:
	// Tracing route to google.com [216.58.211.142]
	//   1     1 ms     1 ms     1 ms  192.168.1.1
	//   2    20 ms    10 ms    11 ms  10.0.0.1
	//   3     *        *        *     Request timed out.

	// Extract hop number, RTT values, and IP address
	regex := regexp.MustCompile(`\s*(\d+)\s+(?:(<?\d+)\s+ms\s+(<?\d+)\s+ms\s+(<?\d+)\s+ms|[*]\s+[*]\s+[*])\s+(?:(\d+\.\d+\.\d+\.\d+)|([a-zA-Z0-9.-]+)|Request timed out)`)

	matches := regex.FindStringSubmatch(line)
	if len(matches) < 2 {
		return HopResult{}
	}

	hopNumber, _ := strconv.Atoi(matches[1])
	hop := HopResult{
		HopNumber: hopNumber,
		TimedOut:  strings.Contains(line, "Request timed out"),
	}

	// Parse RTT values
	var rtts []float64
	for i := 2; i <= 4; i++ {
		if i < len(matches) && matches[i] != "" && matches[i] != "*" {
			rtt, err := strconv.ParseFloat(strings.Trim(matches[i], "<"), 64)
			if err == nil {
				rtts = append(rtts, rtt)
			}
		}
	}

	// Set address based on IP or hostname
	if len(matches) > 5 && matches[5] != "" {
		hop.Address = matches[5]
	} else if len(matches) > 6 && matches[6] != "" {
		hop.Hostname = matches[6]
		// Try to resolve hostname to IP
		addrs, err := net.LookupHost(matches[6])
		if err == nil && len(addrs) > 0 {
			hop.Address = addrs[0]
		}
	}

	// Calculate average RTT
	if len(rtts) > 0 {
		var sum float64
		for _, rtt := range rtts {
			sum += rtt
		}
		hop.RTT = sum / float64(len(rtts))
		hop.AllRTTs = rtts

		// Calculate loss rate
		hop.LossRate = (3 - float64(len(rtts))) / 3 * 100
	} else if hop.TimedOut {
		hop.LossRate = 100
	}

	return hop
}

// parseDarwinTracerouteLine parses macOS traceroute output format
func parseDarwinTracerouteLine(line string) HopResult {
	// Darwin/macOS format:
	// traceroute to google.com (216.58.211.142), 64 hops max, 52 byte packets
	//  1  192.168.1.1 (192.168.1.1)  1.123 ms  0.809 ms  0.773 ms
	//  2  10.0.0.1 (10.0.0.1)  10.201 ms  9.624 ms  9.482 ms
	//  3  * * *

	// Extract hop number, hostname, IP, and RTT values
	regex := regexp.MustCompile(`\s*(\d+)\s+(?:([a-zA-Z0-9.-]+)\s+\((\d+\.\d+\.\d+\.\d+)\)|[*])\s+(?:(\d+\.\d+)\s+ms\s+(\d+\.\d+)\s+ms\s+(\d+\.\d+)\s+ms|[*]\s+[*]\s+[*])`)

	matches := regex.FindStringSubmatch(line)
	if len(matches) < 2 {
		// Try alternate format with just asterisks
		asteriskRegex := regexp.MustCompile(`\s*(\d+)\s+\* \* \*`)
		asteriskMatches := asteriskRegex.FindStringSubmatch(line)
		if len(asteriskMatches) >= 2 {
			hopNumber, _ := strconv.Atoi(asteriskMatches[1])
			return HopResult{
				HopNumber: hopNumber,
				TimedOut:  true,
				LossRate:  100,
			}
		}
		return HopResult{}
	}

	hopNumber, _ := strconv.Atoi(matches[1])
	hop := HopResult{
		HopNumber: hopNumber,
		TimedOut:  strings.Count(line, "*") > 0,
	}

	// Set hostname and IP
	if len(matches) > 2 && matches[2] != "" {
		hop.Hostname = matches[2]
	}

	if len(matches) > 3 && matches[3] != "" {
		hop.Address = matches[3]
	}

	// Parse RTT values
	var rtts []float64
	for i := 4; i <= 6; i++ {
		if i < len(matches) && matches[i] != "" {
			rtt, err := strconv.ParseFloat(matches[i], 64)
			if err == nil {
				rtts = append(rtts, rtt)
			}
		}
	}

	// Calculate average RTT
	if len(rtts) > 0 {
		var sum float64
		for _, rtt := range rtts {
			sum += rtt
		}
		hop.RTT = sum / float64(len(rtts))
		hop.AllRTTs = rtts

		// Calculate loss rate
		hop.LossRate = (3 - float64(len(rtts))) / 3 * 100
	} else if hop.TimedOut {
		hop.LossRate = 100
	}

	return hop
}

// parseLinuxTracerouteLine parses Linux traceroute output format
func parseLinuxTracerouteLine(line string) HopResult {
	// Linux format similar to Darwin
	return parseDarwinTracerouteLine(line)
}

// traceMultipleTargets performs concurrent traceroutes to multiple targets
func traceMultipleTargets(targets []string, maxHops int, useNumeric bool, timeout int) MultiTracerouteResult {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	var wg sync.WaitGroup
	results := make([]TracerouteResult, len(targets))

	startTime := time.Now()

	for i, target := range targets {
		wg.Add(1)
		go func(index int, ip string) {
			defer wg.Done()

			result, _ := runTraceroute(ctx, ip, maxHops, useNumeric)
			results[index] = result
		}(i, target)
	}

	wg.Wait()
	totalTime := time.Since(startTime).Milliseconds()

	// Count successful and failed traces
	successful := 0
	failed := 0
	for _, r := range results {
		if r.Success {
			successful++
		} else {
			failed++
		}
	}

	return MultiTracerouteResult{
		Results:    results,
		TotalTime:  totalTime,
		Successful: successful,
		Failed:     failed,
	}
}

// resolveDomainNames resolves domain names to IP addresses concurrently
func resolveDomainNames(domains []string) map[string]string {
	var wg sync.WaitGroup
	results := make(map[string]string)
	var mu sync.Mutex

	for _, domain := range domains {
		// Skip if already an IP
		if net.ParseIP(domain) != nil {
			continue
		}

		wg.Add(1)
		go func(d string) {
			defer wg.Done()

			addrs, err := net.LookupHost(d)
			if err == nil && len(addrs) > 0 {
				mu.Lock()
				results[d] = addrs[0]
				mu.Unlock()
			}
		}(domain)
	}

	wg.Wait()
	return results
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: traceroute <target1[,target2,...]> [maxHops] [timeout] [numeric]")
		fmt.Println("Examples:")
		fmt.Println("  traceroute google.com")
		fmt.Println("  traceroute google.com,cloudflare.com 30 60 true")
		os.Exit(1)
	}

	targetsArg := os.Args[1]
	targets := strings.Split(targetsArg, ",")

	maxHops := 30
	if len(os.Args) >= 3 {
		if hops, err := strconv.Atoi(os.Args[2]); err == nil && hops > 0 {
			maxHops = hops
		}
	}

	timeout := 60
	if len(os.Args) >= 4 {
		if t, err := strconv.Atoi(os.Args[3]); err == nil && t > 0 {
			timeout = t
		}
	}

	useNumeric := false
	if len(os.Args) >= 5 {
		useNumeric = os.Args[4] == "true" || os.Args[4] == "1"
	}

	// Resolve domain names to IPs in parallel first
	ipMap := resolveDomainNames(targets)

	// Replace domain names with IPs where available
	for i, target := range targets {
		if ip, ok := ipMap[target]; ok {
			targets[i] = ip
		}
	}

	var jsonResult []byte

	if len(targets) == 1 {
		// Single target mode
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
		defer cancel()

		result, _ := runTraceroute(ctx, targets[0], maxHops, useNumeric)
		jsonResult, _ = json.Marshal(result)
	} else {
		// Multiple targets mode
		results := traceMultipleTargets(targets, maxHops, useNumeric, timeout)
		jsonResult, _ = json.Marshal(results)
	}

	fmt.Println(string(jsonResult))
}
