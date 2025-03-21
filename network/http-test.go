package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
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
	Redirects     []string          `json:"redirects,omitempty"`
}

type TLSInfo struct {
	Version             string   `json:"version"`
	CipherSuite         string   `json:"cipherSuite"`
	CertificateInfo     []string `json:"certificateInfo"`
	ValidUntil          string   `json:"validUntil"`
	Issuer              string   `json:"issuer"`
	CertificateExpiring bool     `json:"certificateExpiring"`
	DaysUntilExpiration int      `json:"daysUntilExpiration,omitempty"`
}

type HTTPMultiResult struct {
	Results    []HTTPResult `json:"results"`
	TotalTime  int64        `json:"totalTimeMs"`
	Successful int          `json:"successful"`
	Failed     int          `json:"failed"`
}

func testHTTPEndpoint(url string, timeout int, followRedirects bool, insecure bool) HTTPResult {
	// Create a proper context for the request
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: insecure},
			DialContext: (&net.Dialer{
				Timeout:   time.Duration(timeout) * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}

	var redirects []string

	if !followRedirects {
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			redirects = append(redirects, req.URL.String())
			return http.ErrUseLastResponse
		}
	} else {
		client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
			redirects = append(redirects, req.URL.String())
			if len(via) >= 10 {
				return fmt.Errorf("stopped after 10 redirects")
			}
			return nil
		}
	}

	result := HTTPResult{
		URL:       url,
		Headers:   make(map[string]string),
		Redirects: redirects,
	}

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}

	// Add a user agent to mimic a browser
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")

	startTime := time.Now()
	resp, err := client.Do(req)
	responseTime := time.Since(startTime).Milliseconds()
	result.ResponseTime = responseTime

	if err != nil {
		result.Error = err.Error()
		return result
	}

	defer resp.Body.Close()

	// Set status code
	result.StatusCode = resp.StatusCode

	// Read body with max size limit to avoid huge responses
	maxSize := int64(10 * 1024 * 1024) // 10MB
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSize))
	if err == nil {
		result.ContentLength = int64(len(body))
	}

	// Record headers
	for name, values := range resp.Header {
		if len(values) > 0 {
			result.Headers[name] = values[0]
		}
	}

	// Get TLS info if available
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

			// Calculate days until expiration
			daysUntil := int(cert.NotAfter.Sub(time.Now()).Hours() / 24)
			tlsInfo.DaysUntilExpiration = daysUntil
			tlsInfo.CertificateExpiring = daysUntil < 30

			// Get certificate info
			for _, altName := range cert.DNSNames {
				tlsInfo.CertificateInfo = append(tlsInfo.CertificateInfo, altName)
			}
		}

		result.TLSInfo = tlsInfo
	}

	return result
}

func testMultipleEndpoints(urls []string, timeout int, followRedirects bool, insecure bool) HTTPMultiResult {
	var wg sync.WaitGroup
	results := make([]HTTPResult, len(urls))

	startTime := time.Now()

	for i, url := range urls {
		wg.Add(1)
		go func(index int, endpoint string) {
			defer wg.Done()
			results[index] = testHTTPEndpoint(endpoint, timeout, followRedirects, insecure)
		}(i, url)
	}

	wg.Wait()

	totalTime := time.Since(startTime).Milliseconds()

	// Count successes and failures
	successful := 0
	failed := 0

	for _, r := range results {
		if r.Error == "" && (r.StatusCode >= 200 && r.StatusCode < 400) {
			successful++
		} else {
			failed++
		}
	}

	return HTTPMultiResult{
		Results:    results,
		TotalTime:  totalTime,
		Successful: successful,
		Failed:     failed,
	}
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: http-test <url1[,url2,...]> [timeout] [follow-redirects] [insecure]")
		fmt.Println("Examples:")
		fmt.Println("  http-test https://example.com")
		fmt.Println("  http-test https://example.com,https://google.com 10 1 0")
		os.Exit(1)
	}

	urlsArg := os.Args[1]
	urls := strings.Split(urlsArg, ",")

	timeout := 10
	if len(os.Args) >= 3 {
		timeoutArg, err := strconv.Atoi(os.Args[2])
		if err == nil && timeoutArg > 0 {
			timeout = timeoutArg
		}
	}

	followRedirects := true
	if len(os.Args) >= 4 {
		followRedirectsArg := os.Args[3]
		followRedirects = followRedirectsArg != "0" && followRedirectsArg != "false"
	}

	insecure := false
	if len(os.Args) >= 5 {
		insecureArg := os.Args[4]
		insecure = insecureArg == "1" || insecureArg == "true"
	}

	var jsonResult []byte

	if len(urls) == 1 {
		// Single URL mode
		result := testHTTPEndpoint(urls[0], timeout, followRedirects, insecure)
		jsonResult, _ = json.Marshal(result)
	} else {
		// Multiple URL mode
		results := testMultipleEndpoints(urls, timeout, followRedirects, insecure)
		jsonResult, _ = json.Marshal(results)
	}

	fmt.Println(string(jsonResult))
}
