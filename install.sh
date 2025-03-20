#!/bin/bash
# filepath: install.sh

set -e  # Exit on error

echo "=== Cloud Connect Linux Installer ==="
echo

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check and install prerequisites
install_prerequisites() {
  echo "Checking prerequisites..."
  
  # Determine Linux distribution
  if command_exists apt-get; then
    PKG_MANAGER="apt-get"
    INSTALL_CMD="sudo apt-get install -y"
  elif command_exists dnf; then
    PKG_MANAGER="dnf"
    INSTALL_CMD="sudo dnf install -y"
  elif command_exists yum; then
    PKG_MANAGER="yum"
    INSTALL_CMD="sudo yum install -y"
  else
    echo "Unsupported package manager. Please install Node.js, npm, and Go manually."
    exit 1
  fi
  
  # Check and install Node.js and npm
  if ! command_exists node || ! command_exists npm; then
    echo "Installing Node.js and npm..."
    if [ "$PKG_MANAGER" = "apt-get" ]; then
      sudo apt-get update
      $INSTALL_CMD nodejs npm
    else
      $INSTALL_CMD nodejs npm
    fi
  fi
  
  # Check and install Go
  if ! command_exists go; then
    echo "Installing Go..."
    if [ "$PKG_MANAGER" = "apt-get" ]; then
      sudo apt-get update
      $INSTALL_CMD golang-go
    else
      $INSTALL_CMD golang
    fi
  fi
  
  # Verify installations
  echo "Verifying installations..."
  node -v
  npm -v
  go version
}

# Build and install Cloud Connect
install_cloud_connect() {
  echo "Building Go components..."
  chmod +x build.sh
  ./build.sh
  
  echo "Installing Node.js dependencies..."
  npm install
  
  echo "Setting up global CLI command..."
  chmod +x src/index.js
  
  # Try to use npm link, fall back to local install if sudo not available
  if sudo -n true 2>/dev/null; then
    sudo npm link
    echo "Cloud Connect installed globally with sudo."
  else
    echo "No sudo access detected. Installing locally..."
    mkdir -p "$HOME/.local/bin"
    npm install --prefix "$HOME/.local"
    
    # Create a symlink in ~/.local/bin
    ln -sf "$(pwd)/src/index.js" "$HOME/.local/bin/cloud-connect"
    chmod +x "$HOME/.local/bin/cloud-connect"
    
    # Check if PATH includes ~/.local/bin and advise if not
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
      echo "Please add the following line to your ~/.bashrc or ~/.zshrc file:"
      echo "export PATH=\$PATH:\$HOME/.local/bin"
      echo
      echo "Then run 'source ~/.bashrc' or 'source ~/.zshrc' to update your current session."
    fi
  fi
}

# Main execution
install_prerequisites
install_cloud_connect

echo
echo "=== Installation Complete ==="
echo "You can now use the 'cloud-connect' command from your terminal."
echo "Run 'cloud-connect --help' to see available commands."