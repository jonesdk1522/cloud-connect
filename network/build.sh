#!/bin/bash

# Build script for compiling Go network tools

echo "Building Go network tools..."

# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Make sure Go is available
if ! command -v go &> /dev/null; then
    echo "Error: Go is not installed or not in PATH"
    exit 1
fi

# Create bin directory if it doesn't exist
mkdir -p ../bin

# Build all Go tools and place binaries in bin directory
for file in *.go; do
    name="${file%.go}"
    echo "Building $name..."
    go build -o "../bin/$name" "$file"
    # Make binary executable
    chmod +x "../bin/$name"
    echo -e "Made $name executable ✅"
done

# Make the build script itself executable too
chmod +x "$0"

echo "Build complete. All binaries in ../bin/ are executable"
