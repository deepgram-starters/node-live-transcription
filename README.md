# Node Live Transcription Starter

Live speech-to-text transcription from audio stream URL demo using Deepgram's Read API with Node.js backend and web frontend.

## Sign-up to Deepgram

Before you start, it's essential to generate a Deepgram API key to use in this project. [Sign-up now for Deepgram and create an API key](https://console.deepgram.com/signup?jump=keys).

## Prerequisites

- [Deepgram API Key]((https://console.deepgram.com/signup?jump=keys)) (sign up for free)
- Node.js 24 and pnpm 10+

**Note:** This project uses strict supply chain security measures. npm and yarn will NOT work. See [SECURITY.md](SECURITY.md) for details.

## Quickstart

Follow these steps to get started with this starter application.

1. Clone the repository

Go to GitHub and [clone the repository](https://github.com/deepgram-starters/node-live-transcription).

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

3. Run the application

Start the development servers:

```bash
pnpm dev
```

This will start:
- Backend server on `http://localhost:3000`
- Frontend dev server on `http://localhost:5173` (with proxy to backend)

### 🌐 Open the App

**Development:** [http://localhost:5173](http://localhost:5173) - Vite dev server with proxy to backend

⚠️ **Note:** In this app, Vite proxies WebSocket/API requests to the backend (port 3000). You access the frontend directly at port 5173.


## Production Build

To build and run the production version:

```bash
# Build the frontend
pnpm build

# Start the production server
pnpm start
```

**Production:** [http://localhost:3000](http://localhost:3000) - Backend serves built frontend

## How It Works

This application:
1. Accepts a live audio stream URL via WebSocket connection
2. Fetches the audio stream from the provided URL
3. Pipes the audio data to Deepgram's live transcription API
4. Returns real-time transcription results to the client

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
