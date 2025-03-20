package main

import (
    "encoding/json"
    "fmt"
    "net"
    "os"
)

type InterfaceAddress struct {
    Address string `json:"address"`
    Network string `json:"network"`
    IPVersion int  `json:"ipVersion"`
}

type NetworkInterface struct {
    Name        string            `json:"name"`
    HardwareAddr string           `json:"macAddress"`
    Addresses   []InterfaceAddress `json:"addresses"`
    IsUp        bool              `json:"isUp"`
    MTU         int               `json:"mtu"`
}

type InterfaceResult struct {
    Interfaces []NetworkInterface `json:"interfaces"`
}

func main() {
    ifaces, err := net.Interfaces()
    if err != nil {
        fmt.Printf("{\"error\": \"%s\"}", err)
        os.Exit(1)
    }
    
    var result InterfaceResult
    
    for _, iface := range ifaces {
        netIface := NetworkInterface{
            Name:        iface.Name,
            HardwareAddr: iface.HardwareAddr.String(),
            IsUp:        iface.Flags&net.FlagUp != 0,
            MTU:         iface.MTU,
        }
        
        addrs, err := iface.Addrs()
        if err == nil {
            for _, addr := range addrs {
                var version int
                var ip, network string
                
                switch v := addr.(type) {
                case *net.IPNet:
                    ip = v.IP.String()
                    network = v.String()
                    if v.IP.To4() != nil {
                        version = 4
                    } else {
                        version = 6
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
                    })
                }
            }
        }
        
        result.Interfaces = append(result.Interfaces, netIface)
    }
    
    jsonResult, _ := json.Marshal(result)
    fmt.Println(string(jsonResult))
}