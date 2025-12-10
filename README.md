# Hypha Code Agent

LLM-controlled Python kernel code agent with Hypha integration.

## Features

- 🐍 **Web Python Kernel**: Execute Python code directly in the browser using Pyodide
- 🤖 **AI Agent Mode**: Ask AI to write and execute code for you (coming soon)
- ⚙️ **Configurable**: Support for OpenAI, Ollama, and custom LLM providers
- 🔌 **Hypha Integration**: Register as a service on Hypha server
- 💾 **Persistent Settings**: Configuration stored in localStorage

## Setup

### Prerequisites

- Node.js 18+ and pnpm installed
- Web Python Kernel worker files (automatically copied during setup)

### Installation

```bash
# Install dependencies
pnpm install

# Copy worker files from web-python-kernel (if not already done)
cp ../web-python-kernel/dist/kernel.worker.js public/
cp ../web-python-kernel/dist/kernel.worker.min.js public/
cp -r ../web-python-kernel/dist/pypi public/
```

### Development

```bash
# Start dev server
pnpm run dev

# Server runs at http://localhost:3000/
```

### Build

```bash
# Build for production
pnpm run build

# Preview production build
pnpm run preview
```

## Usage

### Script Mode (Direct Python Execution)

1. Wait for kernel initialization (~10-20 seconds on first load)
2. Make sure "Script" mode is selected
3. Type Python code in the input field
4. Press Enter to execute

Example commands:
```python
print("Hello from Python!")
2 + 2
import sys; print(sys.version)
for i in range(5): print(i)
```

### Query Mode (AI Agent) - Coming Soon

1. Select "Query" mode
2. Ask the AI to write and execute code
3. The agent will generate Python code and run it for you

## Settings

Click the ⚙️ Settings button to configure:

- **OpenAI Provider**: OpenAI, Ollama (local), or Custom
- **Base URL**: API endpoint (e.g., `http://localhost:11434/v1/`)
- **Model**: Model name (e.g., `qwen2.5-coder:7b`, `gpt-4`)
- **API Key**: Your API key (stored locally)
- **Hypha Server URL**: Hypha server endpoint
- **Hypha Workspace**: Your workspace name

Settings are stored in browser localStorage and persist across sessions.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for detailed implementation plan and architecture.

## Development Status

- ✅ Phase 1: Project setup and settings UI
- ✅ Phase 2: Web Python Kernel integration
- 🚧 Phase 3: OpenAI Agent integration (in progress)
- ⏳ Phase 4: Hypha service registration
- ⏳ Phase 5: Terminal UI enhancements
- ⏳ Phase 6: OpenAI API compatibility via ASGI
- ⏳ Phase 7: Testing and integration
- ⏳ Phase 8: Deployment

## License

MIT
