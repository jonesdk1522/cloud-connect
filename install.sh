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
    
    # Setup shell completion for supported shells
    echo "Setting up command completion..."
    COMPLETION_DIR="/etc/bash_completion.d"
    if [[ -d "$COMPLETION_DIR" ]]; then
      cloud-connect completion bash | sudo tee "$COMPLETION_DIR/cloud-connect" > /dev/null
      echo "Installed bash completion to $COMPLETION_DIR"
    fi
    
    # Check for zsh
    if command -v zsh >/dev/null 2>&1; then
      ZSH_COMPLETION_DIR="/usr/local/share/zsh/site-functions"
      if [[ ! -d "$ZSH_COMPLETION_DIR" ]]; then
        sudo mkdir -p "$ZSH_COMPLETION_DIR"
      fi
      cloud-connect completion zsh | sudo tee "$ZSH_COMPLETION_DIR/_cloud-connect" > /dev/null
      echo "Installed zsh completion to $ZSH_COMPLETION_DIR"
    fi
    
    # Check for fish
    if command -v fish >/dev/null 2>&1; then
      FISH_COMPLETION_DIR="/usr/share/fish/vendor_completions.d"
      if [[ ! -d "$FISH_COMPLETION_DIR" ]]; then
        sudo mkdir -p "$FISH_COMPLETION_DIR"
      fi
      cloud-connect completion fish | sudo tee "$FISH_COMPLETION_DIR/cloud-connect.fish" > /dev/null
      echo "Installed fish completion to $FISH_COMPLETION_DIR"
    fi
  else
    echo "No sudo access detected. Installing locally..."
    
    # Create local bin directory if it doesn't exist
    LOCAL_BIN="$HOME/.local/bin"
    mkdir -p "$LOCAL_BIN"
    
    # Install npm dependencies locally
    npm install --prefix "$HOME/.local"
    
    # Create absolute path symlink
    SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/src/index.js"
    ln -sf "$SCRIPT_PATH" "$LOCAL_BIN/cloud-connect"
    chmod +x "$LOCAL_BIN/cloud-connect"
    
    # Check if PATH includes ~/.local/bin and advise if not
    if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
      echo
      echo "To complete installation, add the following line to your shell profile"
      echo "(.bashrc, .zshrc, etc):"
      echo
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
      echo
      echo "Then run: source ~/.bashrc (or ~/.zshrc)"
    fi
    
    # Setup local shell completion
    echo "Setting up local command completion..."
    mkdir -p "$HOME/.local/share/bash-completion/completions"
    cloud-connect completion bash > "$HOME/.local/share/bash-completion/completions/cloud-connect"
    
    if command -v zsh >/dev/null 2>&1; then
      mkdir -p "$HOME/.local/share/zsh/site-functions"
      cloud-connect completion zsh > "$HOME/.local/share/zsh/site-functions/_cloud-connect"
    fi
    
    if command -v fish >/dev/null 2>&1; then
      mkdir -p "$HOME/.config/fish/completions"
      cloud-connect completion fish > "$HOME/.config/fish/completions/cloud-connect.fish"
    fi
    
    # Add completion sourcing to shell config if not already present
    for RC_FILE in ~/.bashrc ~/.zshrc; do
      if [[ -f "$RC_FILE" ]]; then
        if ! grep -q "cloud-connect completion" "$RC_FILE"; then
          echo "# Cloud Connect completion" >> "$RC_FILE"
          echo "source $HOME/.local/share/bash-completion/completions/cloud-connect 2>/dev/null" >> "$RC_FILE"
        fi
      fi
    done
  fi
}

# Main execution
install_prerequisites
install_cloud_connect

echo
echo "=== Installation Complete ==="
echo "You can now use the 'cloud-connect' command from your terminal."
echo "Run 'cloud-connect --help' to see available commands."