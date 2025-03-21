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

# Enable nullglob to ensure an empty pattern expands to nothing
shopt -s nullglob

# Create bin directory if it doesn't exist
mkdir -p ./bin

# List and debug files found in network directory
files=(network/*.go)
echo "Found ${#files[@]} Go file(s): ${files[*]}"

# Build all Go tools and place binaries in bin directory
for file in "${files[@]}"; do
    name="${file%.go}"
    name="${name##*/}"
    echo "Building $name from $file..."
    go build -o "./bin/$name" "$file"
    # Make binary executable
    chmod +x "./bin/$name"
    echo -e "Made $name executable ✅"
done

# Make the build script itself executable too
chmod +x "$0"

echo "Build complete. All binaries in ./bin/ are executable"
