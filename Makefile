# Live Transcription Makefile
# Framework-agnostic commands for managing the project and git submodules

# Use corepack to ensure correct pnpm version
PNPM := corepack pnpm

.PHONY: help init install install-frontend build dev start clean

# Default target: show help
help:
	@echo "Live Transcription - Available Commands"
	@echo "========================================"
	@echo ""
	@echo "Setup:"
	@echo "  make init              Initialize submodules and install all dependencies"
	@echo "  make install           Install backend dependencies only"
	@echo "  make install-frontend  Install frontend dependencies only"
	@echo ""
	@echo "Development:"
	@echo "  make dev               Start development servers (backend + frontend)"
	@echo "  make start             Start production server"
	@echo "  make build             Build frontend for production"
	@echo ""
	@echo "Maintenance:"
	@echo "  make update            Update submodules to latest commits"
	@echo "  make clean             Remove node_modules and build artifacts"
	@echo "  make status            Show git and submodule status"
	@echo ""

# Initialize project: clone submodules and install dependencies
init:
	@echo "==> Initializing submodules..."
	git submodule update --init --recursive
	@echo ""
	@echo "==> Installing backend dependencies..."
	$(PNPM) install
	@echo ""
	@echo "==> Installing frontend dependencies..."
	cd frontend && $(PNPM) install
	@echo ""
	@echo "✓ Project initialized successfully!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Copy sample.env to .env and add your DEEPGRAM_API_KEY"
	@echo "  2. Run 'make dev' to start development servers"
	@echo ""

# Install backend dependencies
install:
	@echo "==> Installing backend dependencies..."
	$(PNPM) install

# Install frontend dependencies (requires submodule to be initialized)
install-frontend:
	@echo "==> Installing frontend dependencies..."
	@if [ ! -d "frontend" ] || [ -z "$$(ls -A frontend)" ]; then \
		echo "Error: Frontend submodule not initialized. Run 'make init' first."; \
		exit 1; \
	fi
	cd frontend && $(PNPM) install

# Build frontend for production
build:
	@echo "==> Building frontend..."
	@if [ ! -d "frontend" ] || [ -z "$$(ls -A frontend)" ]; then \
		echo "Error: Frontend submodule not initialized. Run 'make init' first."; \
		exit 1; \
	fi
	cd frontend && $(PNPM) build
	@echo "✓ Frontend built to frontend/dist/"

# Start development servers (backend + frontend with hot reload)
dev:
	@echo "==> Starting development servers..."
	@if [ ! -f ".env" ]; then \
		echo "Error: .env file not found. Copy sample.env to .env and add your DEEPGRAM_API_KEY"; \
		exit 1; \
	fi
	@if [ ! -d "frontend" ] || [ -z "$$(ls -A frontend)" ]; then \
		echo "Error: Frontend submodule not initialized. Run 'make init' first."; \
		exit 1; \
	fi
	$(PNPM) dev

# Start production server (requires build)
start:
	@echo "==> Starting production server..."
	@if [ ! -f ".env" ]; then \
		echo "Error: .env file not found. Copy sample.env to .env and add your DEEPGRAM_API_KEY"; \
		exit 1; \
	fi
	@if [ ! -d "frontend/dist" ]; then \
		echo "Error: Frontend not built. Run 'make build' first."; \
		exit 1; \
	fi
	$(PNPM) start

# Update submodules to latest commits
update:
	@echo "==> Updating submodules..."
	git submodule update --remote --merge
	@echo "✓ Submodules updated"

# Clean all dependencies and build artifacts
clean:
	@echo "==> Cleaning node_modules and build artifacts..."
	rm -rf node_modules
	rm -rf frontend/node_modules
	rm -rf frontend/dist
	@echo "✓ Cleaned successfully"

# Show git and submodule status
status:
	@echo "==> Repository Status"
	@echo "====================="
	@echo ""
	@echo "Main Repository:"
	git status --short
	@echo ""
	@echo "Submodule Status:"
	git submodule status
	@echo ""
	@echo "Submodule Branches:"
	@cd frontend && echo "frontend: $$(git branch --show-current) ($$(git rev-parse --short HEAD))"
