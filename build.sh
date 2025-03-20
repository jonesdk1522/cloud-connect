#!/bin/bash

# Create bin directory if it doesn't exist
mkdir -p bin

echo "Building network tools..."

# Build each Go file into the bin directory
go build -o bin/traceroute network/traceroute.go
go build -o bin/portscan network/portscan.go
go build -o bin/interfaces network/interfaces.go
go build -o bin/http-test network/http-test.go
go build -o bin/dns network/dns.go
go build -o bin/connectivity network/connectivity.go

echo "Done building network tools."
