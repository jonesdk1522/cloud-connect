package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"strconv"
	"sync"
	"time"
)

type PortResult struct {
	Port    int    `json:"port"`
	Open    bool   `json:"open"`
	Service string `json:"service,omitempty"`
}

type ScanResult struct {
	TargetIP    string       `json:"targetIp"`
	OpenPorts   []PortResult `json:"openPorts"`
	ClosedPorts []PortResult `json:"closedPorts,omitempty"`
	ScanTime    int64        `json:"scanTimeMs"`
}

func scanPort(ip string, port int, timeout time.Duration) PortResult {
	address := fmt.Sprintf("%s:%d", ip, port)
	conn, err := net.DialTimeout("tcp", address, timeout)

	result := PortResult{Port: port}

	if err != nil {
		result.Open = false
		return result
	}

	defer conn.Close()
	result.Open = true

	// Basic service detection could be added here
	if port == 80 || port == 8080 {
		result.Service = "HTTP"
	} else if port == 443 {
		result.Service = "HTTPS"
	} else if port == 22 {
		result.Service = "SSH"
	}

	return result
}

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: portscan <targetIP> <portRangeStart>-<portRangeEnd> [timeout]")
		os.Exit(1)
	}

	targetIP := os.Args[1]
	portRange := os.Args[2]

	var startPort, endPort int
	fmt.Sscanf(portRange, "%d-%d", &startPort, &endPort)

	if startPort <= 0 || endPort <= 0 || startPort > endPort {
		fmt.Println("Invalid port range. Use format: 1-1000")
		os.Exit(1)
	}

	timeout := 2
	if len(os.Args) >= 4 {
		timeoutArg, err := strconv.Atoi(os.Args[3])
		if err == nil {
			timeout = timeoutArg
		}
	}

	startTime := time.Now()

	var wg sync.WaitGroup
	resultChan := make(chan PortResult, endPort-startPort+1)

	for port := startPort; port <= endPort; port++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			result := scanPort(targetIP, p, time.Duration(timeout)*time.Second)
			resultChan <- result
		}(port)
	}

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

	scanResult := ScanResult{
		TargetIP:  targetIP,
		OpenPorts: openPorts,
		ScanTime:  scanTime,
	}

	jsonResult, _ := json.Marshal(scanResult)
	fmt.Println(string(jsonResult))
}
