# Node Live Transcription Starter

Live speech-to-text transcription demo using Deepgram's Listen API with Node.js backend and web frontend.

## Sign-up to Deepgram

Before you start, it's essential to generate a Deepgram API key to use in this project. [Sign-up now for Deepgram and create an API key](https://console.deepgram.com/signup?jump=keys).

## Prerequisites

- [Deepgram API Key]((https://console.deepgram.com/signup?jump=keys)) (sign up for free)
- Node.js 24 and pnpm 10+

**Note:** This project uses strict supply chain security measures. npm and yarn will NOT work. See [SECURITY.md](SECURITY.md) for details.

## Quickstart

Follow these steps to get started with this starter application.

1. Clone the repository

Clone the repository with submodules (the frontend is a shared submodule):

```bash
git clone --recurse-submodules https://github.com/deepgram-starters/node-live-transcription.git
cd node-live-transcription
```

2. Install dependencies

Install the project dependencies:

```bash
# Option 1: Use the helper script (recommended)
pnpm run install:all

# Option 2: Manual two-step install
pnpm install
cd frontend && pnpm install && cd ..
```

**Note:** Due to security settings (`ignore-scripts=true`), frontend dependencies must be installed separately. The `install:all` script handles both steps.

2. **Set your API key**

Create a `.env` file:

```bash
DEEPGRAM_API_KEY=your_api_key_here
```

3. **Run the app**

**Development mode** (with hot reload):

```bash
pnpm dev
```

**Production mode** (build and serve)

```bash
# Build the frontend
pnpm build

# Start the production server
pnpm start
```

### 🌐 Open the App

[http://localhost:8080](http://localhost:8080)

## How It Works

This application:
1. Accepts a live audio stream URL via WebSocket connection
2. Fetches the audio stream from the provided URL
3. Sends binary audio data to Deepgram's live Speech-to-Text API
4. Returns real-time transcription results to the client

## Makefile Commands

This project includes a Makefile for framework-agnostic operations:

```bash
make help              # Show all available commands
make init              # Initialize submodules and install dependencies
make dev               # Start development servers
make build             # Build frontend for production
make start             # Start production server
make update            # Update submodules to latest
make clean             # Remove node_modules and build artifacts
make status            # Show git and submodule status
```

Use `make` commands for a consistent experience regardless of package manager.

## Getting Help

- [Open an issue in this repository](https://github.com/deepgram-starters/node-live-transcription/issues/new)
- [Join the Deepgram Github Discussions Community](https://github.com/orgs/deepgram/discussions)
- [Join the Deepgram Discord Community](https://discord.gg/xWRaCDBtW4)


## Contributing

See our [Contributing Guidelines](./CONTRIBUTING.md) to learn about contributing to this project.

## Code of Conduct

This project follows the [Deepgram Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

For security policy and procedures, see our [Security Policy](./SECURITY.md).

## License

MIT - See [LICENSE](./LICENSE)
