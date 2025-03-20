package main

import (
    "encoding/json"
    "fmt"
    "net"
    "os"
    "os/exec"
    "strconv"
    "time"
)

type ConnectivityResult struct {
    Success bool   `json:"success"`
    Message string `json:"message"`
    TargetIP string `json:"targetIp"`
    ResponseTime int64 `json:"responseTimeMs"`
}

func checkPing(targetIP string, timeout int) ConnectivityResult {
    cmd := exec.Command("ping", "-c", "1", "-W", strconv.Itoa(timeout), targetIP)
    startTime := time.Now()
    err := cmd.Run()
    elapsed := time.Since(startTime).Milliseconds()
    
    if err != nil {
        return ConnectivityResult{
            Success: false,
            Message: fmt.Sprintf("Could not reach %s", targetIP),
            TargetIP: targetIP,
            ResponseTime: 0,
        }
    }
    
    return ConnectivityResult{
        Success: true,
        Message: fmt.Sprintf("Successfully reached %s in %dms", targetIP, elapsed),
        TargetIP: targetIP,
        ResponseTime: elapsed,
    }
}

func checkTcpPort(targetIP string, port int, timeout int) ConnectivityResult {
    address := fmt.Sprintf("%s:%d", targetIP, port)
    startTime := time.Now()
    conn, err := net.DialTimeout("tcp", address, time.Duration(timeout) * time.Second)
    elapsed := time.Since(startTime).Milliseconds()
    
    if err != nil {
        return ConnectivityResult{
            Success: false,
            Message: fmt.Sprintf("Could not connect to %s:%d - %s", targetIP, port, err),
            TargetIP: targetIP,
            ResponseTime: 0,
        }
    }
    
    defer conn.Close()
    return ConnectivityResult{
        Success: true,
        Message: fmt.Sprintf("Successfully connected to %s:%d in %dms", targetIP, port, elapsed),
        TargetIP: targetIP,
        ResponseTime: elapsed,
    }
}

func main() {
    if len(os.Args) < 3 {
        fmt.Println("Usage: connectivity <targetIP> <mode> [port] [timeout]")
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
    } else {
        result = ConnectivityResult{
            Success: false,
            Message: fmt.Sprintf("Unknown mode: %s. Use 'ping' or 'tcp'", mode),
            TargetIP: targetIP,
        }
    }
    
    jsonResult, _ := json.Marshal(result)
    fmt.Println(string(jsonResult))
}