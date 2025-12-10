# Hypha Code Agent

LLM-controlled Python kernel code agent with Hypha integration.

## Features

- 🐍 **Web Python Kernel**: Execute Python code directly in the browser using Pyodide
- 🤖 **AI Agent Mode**: Ask AI to write and execute code with React Loop reasoning
- ⚙️ **Configurable**: Support for OpenAI, Ollama, and custom LLM providers
- 🔌 **Hypha Integration**: Register as a service on Hypha server
- 💾 **Persistent Settings**: Configuration stored in localStorage
- 🎨 **Enhanced Terminal UI**:
  - Syntax highlighting for Python code blocks
  - Markdown rendering for AI responses
  - Copy-to-clipboard for code snippets
  - Command history with arrow key navigation
  - VS Code Dark+ color theme

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

## Deployment

The application is automatically deployed to GitHub Pages when changes are pushed to the main branch.

**Live URL**: [https://code-agent.aicell.io](https://code-agent.aicell.io)

### GitHub Actions Workflow

The project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that:
- Builds the application on every push to main
- Automatically deploys to GitHub Pages
- Handles CNAME configuration for custom domain

### Manual Deployment

To manually deploy:
1. Ensure you have GitHub Pages enabled in repository settings
2. Push changes to the main branch
3. GitHub Actions will automatically build and deploy

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

### Query Mode (AI Agent with React Loop)

1. Select "Query" mode
2. Ask the AI to write and execute code in natural language
3. The agent uses **React Loop** by default for:
   - Multi-step reasoning and code execution
   - Automatic error recovery and debugging
   - Complex task breakdown
   - Extended reasoning across multiple steps

Example queries:
```
Calculate the factorial of 10
Create a plot showing y = x^2 from -5 to 5
Generate 100 random numbers and show their mean and standard deviation
Analyze the iris dataset: load it, calculate statistics, and create visualizations
Debug any errors in my previous code and fix them
```

#### React Loop Features

- **Multi-step reasoning**: AI can execute multiple code blocks in sequence
- **Error recovery**: If code fails, AI analyzes the error and tries alternative approaches
- **Extended context**: Maintains conversation history across reasoning steps
- **Progress tracking**: Shows current step (e.g., "🔄 React Loop Step 3/10")
- **Maximum 10 steps**: Prevents infinite loops while allowing complex workflows

#### Single-Step Mode (Optional)

For simple queries that need only one execution, use the `/single` prefix:
```
/single print("Hello, World!")
```

## Settings

Click the ⚙️ Settings button to configure:

- **OpenAI Provider**: OpenAI, Ollama (local), or Custom
- **Base URL**: API endpoint (e.g., `http://localhost:11434/v1/`)
- **Model**: Model name (e.g., `qwen2.5-coder:7b`, `gpt-4`)
- **API Key**: Your API key (stored locally)
- **Hypha Server URL**: Hypha server endpoint (default: `https://hypha.aicell.io`)
- **Hypha Workspace**: Your workspace name on Hypha (default: `default`)
- **Max Reasoning Steps**: Maximum steps for React loop (1-50, default: 25)

## Hypha Integration

Connect your code agent to Hypha to make it accessible as a remote service:

1. Click **"Connect to Hypha"** button
2. If no token is provided, a login window will open
3. Log in with your Hypha account
4. The service will be registered automatically

Once connected, your code agent becomes available as:
- **Service URL**: `https://hypha.aicell.io/{workspace}/services/{service_id}`
- **MCP URL**: `https://hypha.aicell.io/{workspace}/mcp/{service_id}/mcp`

### Available Service Methods

- `chatCompletion(messages, model, temperature, stream, max_steps)` - OpenAI-compatible chat endpoint with code execution
- `executeCode(code)` - Direct Python code execution
- `getServiceInfo()` - Get service information and status

Settings are stored in browser localStorage and persist across sessions.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for detailed implementation plan and architecture.

## Development Status

- ✅ Phase 1: Project setup and settings UI
- ✅ Phase 2: Web Python Kernel integration
- ✅ Phase 3: OpenAI Agent integration with React Loop
- ✅ Phase 4: Hypha service registration
- ✅ Phase 5: Terminal UI enhancements
- ✅ Phase 6: GitHub Pages deployment setup
- ⏳ Phase 7: Testing and integration
- ⏳ Phase 8: Documentation and polish

**Note**: Phase 6 originally planned for ASGI service (Python backend) was replaced with direct GitHub Pages deployment since this is a browser-based application. The Hypha MCP service already provides remote access capabilities.

