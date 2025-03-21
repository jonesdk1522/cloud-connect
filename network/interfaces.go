package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type InterfaceAddress struct {
	Address   string `json:"address"`
	Network   string `json:"network"`
	IPVersion int    `json:"ipVersion"`
	CIDR      string `json:"cidr"`
	Netmask   string `json:"netmask"`
	Broadcast string `json:"broadcast,omitempty"`
}

type NetworkInterface struct {
	Name         string             `json:"name"`
	HardwareAddr string             `json:"macAddress"`
	Addresses    []InterfaceAddress `json:"addresses"`
	IsUp         bool               `json:"isUp"`
	MTU          int                `json:"mtu"`
	IsLoopback   bool               `json:"isLoopback"`
	IsWireless   bool               `json:"isWireless"`
	Duplex       string             `json:"duplex,omitempty"`
	Speed        int64              `json:"speedMbps,omitempty"`
	Stats        *InterfaceStats    `json:"stats,omitempty"`
	DefaultRoute bool               `json:"defaultRoute"`
}

type InterfaceStats struct {
	TxBytes   int64 `json:"txBytes"`
	RxBytes   int64 `json:"rxBytes"`
	TxPackets int64 `json:"txPackets"`
	RxPackets int64 `json:"rxPackets"`
	TxErrors  int64 `json:"txErrors"`
	RxErrors  int64 `json:"rxErrors"`
}

type InterfaceResult struct {
	Interfaces     []NetworkInterface `json:"interfaces"`
	DefaultGateway string             `json:"defaultGateway,omitempty"`
	DefaultIface   string             `json:"defaultInterface,omitempty"`
	CollectionTime int64              `json:"collectionTimeMs"`
}

// isWireless checks if an interface is wireless
func isWireless(name string) bool {
	if strings.HasPrefix(name, "wl") || strings.HasPrefix(name, "wlan") || strings.HasPrefix(name, "en") && strings.Contains(name, "w") {
		return true
	}

	// Check for wireless interfaces on Linux
	if _, err := os.Stat("/sys/class/net/" + name + "/wireless"); err == nil {
		return true
	}

	// Check on macOS
	if isDarwin() {
		cmd := exec.Command("networksetup", "-listallhardwareports")
		output, err := cmd.Output()
		if err == nil {
			return strings.Contains(string(output), "Wi-Fi") && strings.Contains(string(output), name)
		}
	}

	return false
}

// isDarwin detects if running on macOS
func isDarwin() bool {
	output, err := exec.Command("uname").Output()
	return err == nil && strings.TrimSpace(string(output)) == "Darwin"
}

// isWindows detects if running on Windows OS
func isWindows() bool {
	return os.PathSeparator == '\\' && os.PathListSeparator == ';'
}

// getDefaultRoute gets the default gateway and interface
func getDefaultRoute() (gateway, iface string) {
	if isWindows() {
		return getDefaultRouteWindows()
	} else if isDarwin() {
		return getDefaultRouteDarwin()
	} else {
		return getDefaultRouteLinux()
	}
}

// getDefaultRouteLinux gets the default gateway on Linux
func getDefaultRouteLinux() (gateway, iface string) {
	cmd := exec.Command("ip", "route", "show", "default")
	output, err := cmd.Output()
	if err != nil {
		return "", ""
	}

	// Parse output like "default via 192.168.1.1 dev eth0"
	outputStr := string(output)
	matches := regexp.MustCompile(`default via ([0-9.]+) dev (\S+)`).FindStringSubmatch(outputStr)
	if len(matches) >= 3 {
		return matches[1], matches[2]
	}

	return "", ""
}

// getDefaultRouteDarwin gets the default gateway on macOS
func getDefaultRouteDarwin() (gateway, iface string) {
	cmd := exec.Command("netstat", "-nr")
	output, err := cmd.Output()
	if err != nil {
		return "", ""
	}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "default") {
			fields := strings.Fields(line)
			if len(fields) >= 4 {
				return fields[1], fields[3]
			}
		}
	}

	return "", ""
}

// getDefaultRouteWindows gets the default gateway on Windows
func getDefaultRouteWindows() (gateway, iface string) {
	cmd := exec.Command("route", "print", "0.0.0.0")
	output, err := cmd.Output()
	if err != nil {
		return "", ""
	}

	lines := strings.Split(string(output), "\n")
	for i, line := range lines {
		if strings.Contains(line, "0.0.0.0") && strings.Contains(line, "0.0.0.0") {
			fields := strings.Fields(line)
			if len(fields) >= 4 {
				gateway = fields[3]

				// Try to find interface from index
				if i+1 < len(lines) {
					nextFields := strings.Fields(lines[i+1])
					if len(nextFields) > 0 {
						iface = nextFields[0]
					}
				}

				return gateway, iface
			}
		}
	}

	return "", ""
}

// getInterfaceStats gets network interface statistics
func getInterfaceStats(name string) *InterfaceStats {
	stats := &InterfaceStats{}

	if isWindows() {
		// Windows doesn't have easy command-line stats access
		return nil
	}

	// Read stats from /sys/class/net/{iface}/statistics/ on Linux
	if _, err := os.Stat("/sys/class/net"); err == nil {
		statsDir := filepath.Join("/sys/class/net", name, "statistics")

		// Define stats files to read
		statFiles := map[string]*int64{
			"tx_bytes":   &stats.TxBytes,
			"rx_bytes":   &stats.RxBytes,
			"tx_packets": &stats.TxPackets,
			"rx_packets": &stats.RxPackets,
			"tx_errors":  &stats.TxErrors,
			"rx_errors":  &stats.RxErrors,
		}

		for file, ptr := range statFiles {
			path := filepath.Join(statsDir, file)
			if data, err := os.ReadFile(path); err == nil {
				val, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
				if err == nil {
					*ptr = val
				}
			}
		}

		return stats
	}

	// On macOS, use netstat
	if isDarwin() {
		cmd := exec.Command("netstat", "-I", name, "-b")
		output, err := cmd.Output()
		if err != nil {
			return nil
		}

		lines := strings.Split(string(output), "\n")
		if len(lines) < 2 {
			return nil
		}

		// Parse the output
		fields := strings.Fields(lines[1])
		if len(fields) >= 10 {
			stats.RxBytes, _ = strconv.ParseInt(fields[6], 10, 64)
			stats.TxBytes, _ = strconv.ParseInt(fields[9], 10, 64)
			stats.RxPackets, _ = strconv.ParseInt(fields[4], 10, 64)
			stats.TxPackets, _ = strconv.ParseInt(fields[7], 10, 64)
			stats.RxErrors, _ = strconv.ParseInt(fields[5], 10, 64)
			stats.TxErrors, _ = strconv.ParseInt(fields[8], 10, 64)
		}

		return stats
	}

	return nil
}

// getInterfaceSpeed gets the interface speed and duplex
func getInterfaceSpeed(name string) (int64, string) {
	// On Linux, check /sys/class/net/{iface}/speed
	if _, err := os.Stat("/sys/class/net"); err == nil {
		// Check speed
		speedPath := filepath.Join("/sys/class/net", name, "speed")
		if data, err := os.ReadFile(speedPath); err == nil {
			speed, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
			if err == nil {
				// Check duplex
				duplexPath := filepath.Join("/sys/class/net", name, "duplex")
				if duplexData, err := os.ReadFile(duplexPath); err == nil {
					duplex := strings.TrimSpace(string(duplexData))
					return speed, duplex
				}
				return speed, ""
			}
		}
	}

	// On macOS, use networksetup or system_profiler
	if isDarwin() {
		cmd := exec.Command("system_profiler", "SPNetworkDataType")
		output, err := cmd.Output()
		if err == nil {
			lines := strings.Split(string(output), "\n")
			inInterface := false

			for _, line := range lines {
				if strings.Contains(line, name+":") {
					inInterface = true
				}

				if inInterface && strings.Contains(line, "Speed:") {
					speedStr := strings.TrimSpace(strings.Split(line, ":")[1])
					speedStr = strings.Replace(speedStr, "Mbit/s", "", -1)
					speedStr = strings.Replace(speedStr, "Mbps", "", -1)
					speedStr = strings.TrimSpace(speedStr)
					speed, err := strconv.ParseInt(speedStr, 10, 64)
					if err == nil {
						return speed, ""
					}
				}

				if inInterface && strings.Contains(line, "Duplex:") {
					duplexStr := strings.TrimSpace(strings.Split(line, ":")[1])
					return 0, strings.ToLower(duplexStr)
				}

				// End of this interface section
				if inInterface && strings.TrimSpace(line) == "" {
					inInterface = false
				}
			}
		}
	}

	return 0, ""
}

// getInterfaceInfo collects detailed information about a network interface
func getInterfaceInfo(iface net.Interface) NetworkInterface {
	_, defaultIface := getDefaultRoute()

	netIface := NetworkInterface{
		Name:         iface.Name,
		HardwareAddr: iface.HardwareAddr.String(),
		IsUp:         iface.Flags&net.FlagUp != 0,
		MTU:          iface.MTU,
		IsLoopback:   iface.Flags&net.FlagLoopback != 0,
		IsWireless:   isWireless(iface.Name),
		DefaultRoute: iface.Name == defaultIface,
	}

	// Get speed and duplex
	speed, duplex := getInterfaceSpeed(iface.Name)
	netIface.Speed = speed
	netIface.Duplex = duplex

	// Get statistics
	netIface.Stats = getInterfaceStats(iface.Name)

	// Get addresses
	addrs, err := iface.Addrs()
	if err == nil {
		for _, addr := range addrs {
			var version int
			var ip, network, cidr, netmask, broadcast string

			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP.String()
				network = v.String()
				cidr = v.String()

				if v.IP.To4() != nil {
					version = 4
					// Calculate netmask and broadcast for IPv4
					mask := v.Mask
					netmask = fmt.Sprintf("%d.%d.%d.%d", mask[0], mask[1], mask[2], mask[3])

					// Calculate broadcast address safely
					ip4 := v.IP.To4()
					if ip4 != nil && len(mask) == 4 {
						broadcastIP := make(net.IP, 4)
						for i := 0; i < 4; i++ {
							broadcastIP[i] = ip4[i] | ^mask[i]
						}
						broadcast = broadcastIP.String()
					}
				} else {
					version = 6
					// IPv6 doesn't have broadcast
					broadcast = ""
				}
			case *net.IPAddr:
				ip = v.IP.String()
				network = v.String()
				if v.IP.To4() != nil {
					version = 4
				} else {
					version = 6
				}
			}

			if ip != "" {
				netIface.Addresses = append(netIface.Addresses, InterfaceAddress{
					Address:   ip,
					Network:   network,
					IPVersion: version,
					CIDR:      cidr,
					Netmask:   netmask,
					Broadcast: broadcast,
				})
			}
		}
	}

	return netIface
}

// collectAllInterfaceInfo gathers information about all network interfaces concurrently
func collectAllInterfaceInfo() InterfaceResult {
	startTime := time.Now()

	ifaces, err := net.Interfaces()
	if err != nil {
		return InterfaceResult{
			CollectionTime: time.Since(startTime).Milliseconds(),
		}
	}

	var result InterfaceResult
	var wg sync.WaitGroup
	var mu sync.Mutex

	// Get default gateway info
	defaultGateway, defaultIface := getDefaultRoute()
	result.DefaultGateway = defaultGateway
	result.DefaultIface = defaultIface

	// Collect interface info concurrently
	for _, iface := range ifaces {
		wg.Add(1)
		go func(i net.Interface) {
			defer wg.Done()

			netIface := getInterfaceInfo(i)

			mu.Lock()
			result.Interfaces = append(result.Interfaces, netIface)
			mu.Unlock()
		}(iface)
	}

	wg.Wait()
	result.CollectionTime = time.Since(startTime).Milliseconds()

	return result
}

func main() {
	var result InterfaceResult

	// Check if specific interface was requested
	if len(os.Args) > 1 && os.Args[1] != "all" {
		reqIface := os.Args[1]
		iface, err := net.InterfaceByName(reqIface)
		if err != nil {
			fmt.Printf("{\"error\": \"Interface %s not found\"}\n", reqIface)
			os.Exit(1)
		}

		startTime := time.Now()
		netIface := getInterfaceInfo(*iface)

		result.Interfaces = []NetworkInterface{netIface}
		defaultGateway, defaultIface := getDefaultRoute()
		result.DefaultGateway = defaultGateway
		result.DefaultIface = defaultIface
		result.CollectionTime = time.Since(startTime).Milliseconds()
	} else {
		// Get all interfaces
		result = collectAllInterfaceInfo()
	}

	jsonResult, _ := json.Marshal(result)
	fmt.Println(string(jsonResult))
}
