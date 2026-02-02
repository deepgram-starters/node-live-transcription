# Live Transcription Makefile
# Framework-agnostic commands for managing the project and git submodules

# Use corepack to ensure correct pnpm version
PNPM := corepack pnpm

.PHONY: help check-prereqs init install install-frontend start start-backend start-frontend update clean status

# Default target: show help
help:
	@echo "Live Transcription - Available Commands"
	@echo "========================================"
	@echo ""
	@echo "Setup:"
	@echo "  make check-prereqs     Check required tools are installed"
	@echo "  make init              Initialize submodules and install all dependencies"
	@echo "  make install           Install backend dependencies only"
	@echo "  make install-frontend  Install frontend dependencies only"
	@echo ""
	@echo "Development:"
	@echo "  make start             Start both backend and frontend servers in parallel"
	@echo "  make start-backend     Start backend API server only (port 8081)"
	@echo "  make start-frontend    Start frontend dev server only (port 8080)"
	@echo ""
	@echo "Maintenance:"
	@echo "  make update            Update submodules to latest commits"
	@echo "  make clean             Remove node_modules and build artifacts"
	@echo "  make status            Show git and submodule status"
	@echo ""

# Check required prerequisites
check-prereqs:
	@command -v git >/dev/null 2>&1 || { echo "❌ git is required but not installed. Visit https://git-scm.com"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "❌ node is required but not installed. Visit https://nodejs.org"; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { echo "⚠️  pnpm not found. Run: corepack enable"; exit 1; }
	@echo "✓ All prerequisites installed"

# Initialize project: clone submodules and install dependencies
init: check-prereqs
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
	@echo "  2. Run 'make start' to start development servers"
	@echo ""

# Install backend dependencies
install:
	@echo "==> Installing backend dependencies..."
	$(PNPM) install

# Install frontend dependencies (requires submodule to be initialized)
install-frontend:
	@echo "==> Installing frontend dependencies..."
	@if [ ! -d "frontend" ] || [ -z "$$(ls -A frontend)" ]; then \
		echo "❌ Error: Frontend submodule not initialized. Run 'make init' first."; \
		exit 1; \
	fi
	cd frontend && $(PNPM) install

# Start both servers in parallel
start:
	@$(MAKE) start-backend & $(MAKE) start-frontend & wait

# Start backend API server only
start-backend:
	@if [ ! -f ".env" ]; then \
		echo "❌ Error: .env file not found. Copy sample.env to .env and add your DEEPGRAM_API_KEY"; \
		exit 1; \
	fi
	@echo "==> Starting backend on http://localhost:8081"
	$(PNPM) run start-backend

# Start frontend dev server only
start-frontend:
	@if [ ! -d "frontend" ] || [ -z "$$(ls -A frontend)" ]; then \
		echo "❌ Error: Frontend submodule not initialized. Run 'make init' first."; \
		exit 1; \
	fi
	@echo "==> Starting frontend on http://localhost:8080"
	cd frontend && $(PNPM) run dev -- --port 8080 --no-open

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
