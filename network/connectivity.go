package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ConnectivityResult struct {
	Success      bool   `json:"success"`
	Message      string `json:"message"`
	TargetIP     string `json:"targetIp"`
	Port         int    `json:"port,omitempty"`
	Mode         string `json:"mode"`
	ResponseTime int64  `json:"responseTimeMs"`
	PacketLoss   int    `json:"packetLoss,omitempty"`
	RTT          struct {
		Min float64 `json:"min,omitempty"`
		Avg float64 `json:"avg,omitempty"`
		Max float64 `json:"max,omitempty"`
	} `json:"rtt,omitempty"`
}

// Check both ICMP and TCP connectivity in parallel
func checkAllConnectivity(targetIP string, ports []int, timeout int) []ConnectivityResult {
	var results []ConnectivityResult
	var mutex sync.Mutex
	var wg sync.WaitGroup

	// Add ping test
	wg.Add(1)
	go func() {
		defer wg.Done()
		result := checkPing(targetIP, timeout)

		mutex.Lock()
		results = append(results, result)
		mutex.Unlock()
	}()

	// Add TCP tests for each port
	for _, port := range ports {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			result := checkTcpPort(targetIP, p, timeout)

			mutex.Lock()
			results = append(results, result)
			mutex.Unlock()
		}(port)
	}

	wg.Wait()
	return results
}

func checkPing(targetIP string, timeout int) ConnectivityResult {
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	// On macOS and Linux, use different ping parameters
	var cmd *exec.Cmd
	if _, err := os.Stat("/bin/ping"); err == nil {
		cmd = exec.CommandContext(ctx, "ping", "-c", "3", "-W", strconv.Itoa(timeout), targetIP)
	} else {
		// Fallback for Windows
		cmd = exec.CommandContext(ctx, "ping", "-n", "3", "-w", strconv.Itoa(timeout*1000), targetIP)
	}

	startTime := time.Now()
	output, err := cmd.CombinedOutput()
	elapsed := time.Since(startTime).Milliseconds()

	if err != nil {
		return ConnectivityResult{
			Success:      false,
			Message:      fmt.Sprintf("Could not reach %s", targetIP),
			TargetIP:     targetIP,
			Mode:         "ping",
			ResponseTime: 0,
		}
	}

	// Parse output to extract packet loss and RTT stats
	// This is simplistic - could be enhanced for different OS outputs
	packetLoss := 0
	var minRtt, avgRtt, maxRtt float64

	// Simple parsing logic - would need to be improved for different OS outputs
	outputStr := string(output)
	fmt.Sscanf(outputStr, "%*s %*s %*s %*s %d%% %*s", &packetLoss)

	result := ConnectivityResult{
		Success:      true,
		Message:      fmt.Sprintf("Successfully reached %s in %dms", targetIP, elapsed),
		TargetIP:     targetIP,
		Mode:         "ping",
		ResponseTime: elapsed,
		PacketLoss:   packetLoss,
	}

	result.RTT.Min = minRtt
	result.RTT.Avg = avgRtt
	result.RTT.Max = maxRtt

	return result
}

func checkTcpPort(targetIP string, port int, timeout int) ConnectivityResult {
	address := fmt.Sprintf("%s:%d", targetIP, port)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	var dialer net.Dialer
	startTime := time.Now()

	conn, err := dialer.DialContext(ctx, "tcp", address)
	elapsed := time.Since(startTime).Milliseconds()

	if err != nil {
		return ConnectivityResult{
			Success:      false,
			Message:      fmt.Sprintf("Could not connect to %s:%d - %s", targetIP, port, err),
			TargetIP:     targetIP,
			Port:         port,
			Mode:         "tcp",
			ResponseTime: 0,
		}
	}

	defer conn.Close()
	return ConnectivityResult{
		Success:      true,
		Message:      fmt.Sprintf("Successfully connected to %s:%d in %dms", targetIP, port, elapsed),
		TargetIP:     targetIP,
		Port:         port,
		Mode:         "tcp",
		ResponseTime: elapsed,
	}
}

func checkUdpPort(targetIP string, port int, timeout int) ConnectivityResult {
	address := fmt.Sprintf("%s:%d", targetIP, port)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	var dialer net.Dialer
	startTime := time.Now()

	conn, err := dialer.DialContext(ctx, "udp", address)
	if err != nil {
		return ConnectivityResult{
			Success:      false,
			Message:      fmt.Sprintf("Could not create UDP connection to %s:%d - %s", targetIP, port, err),
			TargetIP:     targetIP,
			Port:         port,
			Mode:         "udp",
			ResponseTime: 0,
		}
	}

	// For UDP, just establishing a connection doesn't mean the port is open
	// We'd need to send data and potentially expect a response
	// This is a simplified check
	_, err = conn.Write([]byte("ping"))
	elapsed := time.Since(startTime).Milliseconds()
	defer conn.Close()

	// Simplify the message construction
	var reachability string
	if err == nil {
		reachability = "reachable"
	} else {
		reachability = "unreachable"
	}

	return ConnectivityResult{
		Success:      err == nil,
		Message:      fmt.Sprintf("UDP port %d on %s appears %s", port, targetIP, reachability),
		TargetIP:     targetIP,
		Port:         port,
		Mode:         "udp",
		ResponseTime: elapsed,
	}
}

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: connectivity <targetIP> <mode> [port|port1,port2,...] [timeout]")
		fmt.Println("Modes: ping, tcp, udp, all")
		os.Exit(1)
	}

	targetIP := os.Args[1]
	mode := os.Args[2]

	timeout := 5
	if len(os.Args) >= 5 {
		timeoutArg, err := strconv.Atoi(os.Args[4])
		if err == nil {
			timeout = timeoutArg
		}
	}

	if mode == "all" {
		// Get ports from args or use defaults
		ports := []int{22, 80, 443}
		if len(os.Args) >= 4 {
			portArgs := os.Args[3]
			customPorts := []int{}
			for _, portStr := range strings.Split(portArgs, ",") {
				if portNum, err := strconv.Atoi(portStr); err == nil {
					customPorts = append(customPorts, portNum)
				}
			}
			if len(customPorts) > 0 {
				ports = customPorts
			}
		}

		results := checkAllConnectivity(targetIP, ports, timeout)
		jsonResult, _ := json.Marshal(results)
		fmt.Println(string(jsonResult))
		return
	}

	var result ConnectivityResult

	if mode == "ping" {
		result = checkPing(targetIP, timeout)
	} else if mode == "tcp" {
		port := 80
		if len(os.Args) >= 4 {
			portArg, err := strconv.Atoi(os.Args[3])
			if err == nil {
				port = portArg
			}
		}
		result = checkTcpPort(targetIP, port, timeout)
	} else if mode == "udp" {
		port := 53 // DNS is a common UDP port
		if len(os.Args) >= 4 {
			portArg, err := strconv.Atoi(os.Args[3])
			if err == nil {
				port = portArg
			}
		}
		result = checkUdpPort(targetIP, port, timeout)
	} else {
		result = ConnectivityResult{
			Success:  false,
			Message:  fmt.Sprintf("Unknown mode: %s. Use 'ping', 'tcp', 'udp', or 'all'", mode),
			TargetIP: targetIP,
			Mode:     mode,
		}
	}

	jsonResult, _ := json.Marshal(result)
	fmt.Println(string(jsonResult))
}
