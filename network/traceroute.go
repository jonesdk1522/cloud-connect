package main

import (
    "encoding/json"
    "fmt"
    "net"
    "os"
    "os/exec"
    "regexp"
    "strconv"
    "strings"
)

type HopResult struct {
    HopNumber int     `json:"hop"`
    Address   string  `json:"address"`
    Hostname  string  `json:"hostname,omitempty"`
    RTT       float64 `json:"rttMs"`
}

type TracerouteResult struct {
    TargetIP   string      `json:"targetIp"`
    TargetName string      `json:"targetName,omitempty"`
    Hops       []HopResult `json:"hops"`
    Success    bool        `json:"success"`
}

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Usage: traceroute <targetIP> [maxHops]")
        os.Exit(1)
    }
    
    targetIP := os.Args[1]
    maxHops := "30"
    
    if len(os.Args) >= 3 {
        maxHops = os.Args[2]
    }
    
    var cmd *exec.Cmd
    
    if isWindows() {
        cmd = exec.Command("tracert", "-d", "-h", maxHops, targetIP)
    } else {
        cmd = exec.Command("traceroute", "-n", "-m", maxHops, targetIP)
    }
    
    output, err := cmd.CombinedOutput()
    if err != nil {
        result := TracerouteResult{
            TargetIP: targetIP,
            Success:  false,
        }
        jsonResult, _ := json.Marshal(result)
        fmt.Println(string(jsonResult))
        return
    }
    
    hops := parseTracerouteOutput(string(output), isWindows())
    
    var hostname string
    names, err := net.LookupAddr(targetIP)
    if err == nil && len(names) > 0 {
        hostname = strings.TrimSuffix(names[0], ".")
    }
    
    result := TracerouteResult{
        TargetIP:   targetIP,
        TargetName: hostname,
        Hops:       hops,
        Success:    len(hops) > 0 && hops[len(hops)-1].Address == targetIP,
    }
    
    jsonResult, _ := json.Marshal(result)
    fmt.Println(string(jsonResult))
}

func isWindows() bool {
    return os.PathSeparator == '\\' && os.PathListSeparator == ';'
}

func parseTracerouteOutput(output string, isWindows bool) []HopResult {
    lines := strings.Split(output, "\n")
    var hops []HopResult
    
    var ipRegex *regexp.Regexp
    if isWindows {
        ipRegex = regexp.MustCompile(`\s+(\d+)\s+(?:\*|(\d+) ms\s+\d+ ms\s+\d+ ms)\s+(?:\[?(\d+\.\d+\.\d+\.\d+)\]?)?`)
    } else {
        ipRegex = regexp.MustCompile(`\s*(\d+)\s+(?:\*|\((\d+\.\d+\.\d+\.\d+)\)\s+(\d+\.\d+) ms(?:\s+\d+\.\d+ ms){0,2})`)
    }
    
    for _, line := range lines {
        matches := ipRegex.FindStringSubmatch(line)
        if len(matches) > 0 {
            hopNumber, _ := strconv.Atoi(matches[1])
            var rtt float64
            var ipAddress string
            
            if isWindows {
                if len(matches) > 2 && matches[2] != "" {
                    rtt, _ = strconv.ParseFloat(matches[2], 64)
                }
                if len(matches) > 3 {
                    ipAddress = matches[3]
                }
            } else {
                if len(matches) > 2 {
                    ipAddress = matches[2]
                }
                if len(matches) > 3 && matches[3] != "" {
                    rtt, _ = strconv.ParseFloat(matches[3], 64)
                }
            }
            
            if ipAddress != "" {
                hops = append(hops, HopResult{
                    HopNumber: hopNumber,
                    Address:   ipAddress,
                    RTT:       rtt,
                })
            }
        }
    }
    
    return hops
}