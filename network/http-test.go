package main

import (
    "crypto/tls"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "strconv"
    "time"
)

type HTTPResult struct {
    URL           string            `json:"url"`
    StatusCode    int               `json:"statusCode"`
    ResponseTime  int64             `json:"responseTimeMs"`
    ContentLength int64             `json:"contentLength"`
    Headers       map[string]string `json:"headers"`
    Error         string            `json:"error,omitempty"`
    TLSInfo       *TLSInfo          `json:"tlsInfo,omitempty"`
}

type TLSInfo struct {
    Version         string   `json:"version"`
    CipherSuite     string   `json:"cipherSuite"`
    CertificateInfo []string `json:"certificateInfo"`
    ValidUntil      string   `json:"validUntil"`
    Issuer          string   `json:"issuer"`
}

func main() {
    if len(os.Args) < 2 {
        fmt.Println("Usage: http-test <url> [timeout] [follow-redirects] [insecure]")
        os.Exit(1)
    }
    
    url := os.Args[1]
    timeout := 10
    followRedirects := true
    insecure := false
    
    if len(os.Args) >= 3 {
        timeoutArg, err := strconv.Atoi(os.Args[2])
        if err == nil && timeoutArg > 0 {
            timeout = timeoutArg
        }
    }
    
    if len(os.Args) >= 4 {
        followRedirectsArg := os.Args[3]
        followRedirects = followRedirectsArg != "0" && followRedirectsArg != "false"
    }
    
    if len(os.Args) >= 5 {
        insecureArg := os.Args[4]
        insecure = insecureArg == "1" || insecureArg == "true"
    }
    
    client := &http.Client{
        Timeout: time.Duration(timeout) * time.Second,
        Transport: &http.Transport{
            TLSClientConfig: &tls.Config{InsecureSkipVerify: insecure},
        },
    }
    
    if !followRedirects {
        client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
            return http.ErrUseLastResponse
        }
    }
    
    startTime := time.Now()
    resp, err := client.Get(url)
    responseTime := time.Since(startTime).Milliseconds()
    
    result := HTTPResult{
        URL:          url,
        ResponseTime: responseTime,
        Headers:      make(map[string]string),
    }
    
    if err != nil {
        result.Error = err.Error()
    } else {
        defer resp.Body.Close()
        
        result.StatusCode = resp.StatusCode
        
        body, err := io.ReadAll(resp.Body)
        if err == nil {
            result.ContentLength = int64(len(body))
        }
        
        for name, values := range resp.Header {
            if len(values) > 0 {
                result.Headers[name] = values[0]
            }
        }
        
        if resp.TLS != nil {
            tlsInfo := &TLSInfo{}
            
            switch resp.TLS.Version {
            case tls.VersionTLS10:
                tlsInfo.Version = "TLS 1.0"
            case tls.VersionTLS11:
                tlsInfo.Version = "TLS 1.1"
            case tls.VersionTLS12:
                tlsInfo.Version = "TLS 1.2"
            case tls.VersionTLS13:
                tlsInfo.Version = "TLS 1.3"
            }
            
            tlsInfo.CipherSuite = tls.CipherSuiteName(resp.TLS.CipherSuite)
            
            if len(resp.TLS.PeerCertificates) > 0 {
                cert := resp.TLS.PeerCertificates[0]
                tlsInfo.ValidUntil = cert.NotAfter.Format(time.RFC3339)
                tlsInfo.Issuer = cert.Issuer.CommonName
                
                for _, altName := range cert.DNSNames {
                    tlsInfo.CertificateInfo = append(tlsInfo.CertificateInfo, altName)
                }
            }
            
            result.TLSInfo = tlsInfo
        }
    }
    
    jsonResult, _ := json.Marshal(result)
    fmt.Println(string(jsonResult))
}