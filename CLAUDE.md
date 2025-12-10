# Hypha Code Agent

## Overview

The Hypha Code Agent is a service that enables Large Language Models (LLMs) to control a Python kernel and execute code dynamically while interacting with external tools and responding to user requests.

## Goals

- **LLM-Controlled Kernel**: Allow LLMs to interact with and control a Python kernel for code execution
- **Tool Integration**: Support calling external tools and functions
- **OpenAI API Compatibility**: Provide a simple API that follows OpenAI's API format for easy integration
- **Streaming Support**: Enable real-time streaming responses

## Architecture

### Core Components

1. **API Layer**: OpenAI-compatible REST API endpoint
2. **LLM Integration**: Interface with various LLM providers (OpenAI, Anthropic, etc.)
3. **Kernel Manager**: Manages Python kernel instances for code execution
4. **Tool System**: Extensible tool/function calling framework
5. **Response Handler**: Manages streaming and non-streaming responses

## API Design

### Chat Completions Endpoint

```
POST /v1/chat/completions
```

Request body (OpenAI-compatible):
```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "user", "content": "Write Python code to calculate fibonacci"}
  ],
  "tools": [...],
  "stream": true
}
```

Response:
- Non-streaming: Standard JSON response
- Streaming: Server-Sent Events (SSE) format

## Use Cases

- Interactive code generation and execution
- Data analysis with LLM assistance
- Automated debugging and testing
- Tool-augmented programming assistance

## Technology Stack

 - hypha-rpc
 - openai node package
 - web-python-kernel

## Implementation Plan

### Phase 1: Project Setup & Dependencies

1. **Initialize pnpm Project**
   - Create `package.json` with project metadata
   - Set up TypeScript configuration (`tsconfig.json`)
   - Configure build tools (Vite/esbuild for bundling)

2. **Install Core Dependencies**
   ```bash
   pnpm add openai hypha-rpc web-python-kernel
   pnpm add -D typescript @types/node vite
   ```

3. **Project Structure**
   ```
   hypha-code-agent/
   ├── src/
   │   ├── main.ts              # Entry point
   │   ├── kernel.ts            # Web Python Kernel integration
   │   ├── agent.ts             # OpenAI agent logic
   │   ├── hypha-service.ts     # Hypha RPC service registration
   │   └── ui/
   │       ├── terminal.ts      # Terminal UI component
   │       └── styles.css       # Terminal styling
   ├── public/
   │   └── index.html           # Main HTML file
   ├── package.json
   ├── tsconfig.json
   └── vite.config.ts
   ```

### Phase 2: Web Python Kernel Integration

Reference: `/Users/wei.ouyang/workspace/web-python-kernel/index.html` and `hypha-kernel-service.js`

1. **Kernel Manager Setup**
   - Import `KernelManager`, `KernelMode`, `KernelLanguage` from `web-python-kernel`
   - Initialize kernel manager with worker mode (recommended for isolation)
   - Set up kernel lifecycle management (create, execute, destroy)

2. **Kernel Startup Script**
   - Define a startup script that runs automatically when kernel is created
   - The startup script should:
     - Connect to necessary Hypha services within the Python kernel
     - Import required libraries (e.g., numpy, matplotlib)
     - Set up any required global variables or configurations
     - Register service proxies for external tools
   - Example startup script:
     ```python
     # Connect to Hypha services from within the kernel
     from hypha_rpc import connect_to_server

     # Initialize services that the agent can use
     server = await connect_to_server({"server_url": "https://hypha.aicell.io"})

     # Import common libraries
     import numpy as np
     import matplotlib.pyplot as plt

     print("Kernel initialized with Hypha services")
     ```

3. **Code Execution Interface**
   - Implement `executeCode(code: string): Promise<ExecutionResult>` function
   - Handle execution streams using `kernelManager.executeStream()`
   - Process execution events: `stdout`, `stderr`, `execute_result`, `display_data`, `error`
   - Support for matplotlib/plotly visualization (automatic display)
   - Implement interrupt capability for long-running code

4. **Kernel State Management**
   - Maintain persistent kernel state across executions
   - Support for package installation via micropip
   - Handle kernel restart and cleanup
   - Execute startup script automatically on kernel creation

**Key Implementation Notes:**
- Use **async/await** throughout (Pyodide environment)
- Stream execution results as they arrive
- Handle errors gracefully and report to user
- Support top-level await in Python code
- **Startup script is executed automatically** when kernel is created
- Agent is notified via system prompt that kernel has been initialized with services

### Phase 3: OpenAI Agent Integration

Reference: `/Users/wei.ouyang/workspace/hypha-agents/src/utils/chatCompletion.ts`

1. **OpenAI Client Setup**
   ```typescript
   import OpenAI from 'openai';

   const client = new OpenAI({
     baseURL: config.baseURL || 'http://localhost:11434/v1/',
     apiKey: config.apiKey || 'ollama',
     dangerouslyAllowBrowser: true
   });
   ```

2. **Chat Completion with Tool Calling**
   - Implement streaming chat completion interface
   - Define tool schema for code execution:
     ```typescript
     const EXECUTE_CODE_TOOL = {
       type: "function",
       function: {
         name: "executeCode",
         description: "Execute Python code in the web kernel",
         parameters: {
           type: "object",
           properties: {
             code: { type: "string", description: "Python code to execute" }
           },
           required: ["code"]
         }
       }
     };
     ```

3. **Agent Loop Implementation**
   - Create async generator for streaming responses
   - Handle tool calls from LLM
   - Execute code via kernel when tool is invoked
   - Return execution results back to LLM
   - Support multi-turn conversations with context

4. **Response Streaming**
   - Yield text chunks as they arrive
   - Yield tool call notifications
   - Yield execution results
   - Handle errors and timeouts

**Key Implementation Notes:**
- Always use **async generators** for streaming
- Implement abort controller for cancellation
- Validate agent outputs (prevent invalid responses)
- Support configurable models and parameters

### Phase 4: Hypha Service Registration

Reference: `/Users/wei.ouyang/workspace/hypha/docs/mcp.md` and `web-python-kernel/hypha-kernel-service.js`

1. **Connect to Hypha Server**
   ```typescript
   import { connectToServer } from 'hypha-rpc';

   const server = await connectToServer({
     server_url: config.serverUrl || 'https://hypha.aicell.io',
     workspace: config.workspace || 'default',
     token: config.token
   });
   ```

2. **Register Code Agent Service**
   - Service type: `mcp` (Model Context Protocol compatible)
   - Expose tools for code execution and agent interaction
   - Use `@schema_function` decorator pattern for TypeScript
   - Configure service visibility (public/protected)

3. **Service Interface (OpenAI-Compatible API)**
   ```typescript
   interface CodeAgentService {
     // Main chat completion endpoint (OpenAI-compatible)
     async *chatCompletion(params: {
       messages: ChatMessage[],
       model?: string,
       temperature?: number,
       stream?: boolean
     }): AsyncGenerator<ChatChunk>;

     // Direct code execution
     async executeCode(code: string): Promise<ExecutionResult>;

     // Kernel management
     async restartKernel(): Promise<void>;
     async getKernelStatus(): Promise<KernelStatus>;
   }
   ```

4. **Service Schema Definition**
   - Define JSON schemas for all service functions
   - Include parameter validation
   - Provide clear descriptions for LLM usage

**Key Implementation Notes:**
- Use **async generators** for streaming responses from service functions
- Provide schema for each function (required for MCP)
- Handle authentication via Hypha token
- Support both workspace-scoped and public services
- Expose service at: `{server_url}/{workspace}/services/{service_id}`
- MCP endpoint at: `{server_url}/{workspace}/mcp/{service_id}/mcp`

### Phase 5: Terminal UI Implementation

1. **Terminal Interface Design**
   - Full-screen terminal emulator style
   - Top button bar with controls:
     - "Connect to Hypha" - Connect and register service
     - "Restart Kernel" - Reset Python kernel
     - "Clear Terminal" - Clear output
     - Status indicator (connected/disconnected)
   - Main terminal area:
     - Display agent messages and thoughts
     - Show code execution blocks with syntax highlighting
     - Display execution outputs (stdout, stderr, results)
     - Show visualizations inline
   - Input area at bottom for user queries

2. **Terminal Features**
   - ANSI color code support for colored output
   - Code syntax highlighting (Python)
   - Scroll to bottom on new output
   - Copy-to-clipboard for code blocks
   - Markdown rendering for agent responses

3. **Interactive Elements**
   - Command history (up/down arrows)
   - Auto-complete for common commands
   - Status indicators (busy/idle)
   - Progress bars for long operations

**Key UI Components:**
- Use vanilla TypeScript/JavaScript (no heavy frameworks)
- CodeMirror or Monaco Editor for code display
- ANSI-to-HTML converter for terminal colors
- Simple CSS for terminal styling (monospace, dark theme)

### Phase 6: OpenAI API Compatibility via Hypha ASGI Service

Reference: `/Users/wei.ouyang/workspace/hypha/docs/asgi-apps.md`

Instead of creating a custom HTTP server, we'll register the code agent as a **Hypha ASGI service**. This provides:
- Automatic HTTP endpoint exposure
- Built-in authentication and authorization
- No infrastructure management needed
- Public accessibility without port forwarding

You don't need to implemenmt yourself, we have already utility functions inside hypha-rpc for serve as openai:
/Users/wei.ouyang/workspace/hypha-rpc/python/hypha_rpc/utils/serve.py

See how to use it: /Users/wei.ouyang/workspace/hypha-rpc/python/tests/test_utils.py


1. **ASGI Service Registration**
   - Register service with `type: "asgi"`
   - Implement ASGI application handler function
   - Handle OpenAI-compatible API requests at `/v1/chat/completions`
   - Example:
     ```typescript
     async function serveOpenAI(args, context) {
       const scope = args.scope;
       const receive = args.receive;
       const send = args.send;

       // Handle POST /v1/chat/completions
       if (scope.method === 'POST' && scope.path === '/v1/chat/completions') {
         // Process OpenAI-compatible request
         // Stream response back via ASGI send()
       }
     }

     await server.register_service({
       id: "code-agent",
       type: "asgi",
       serve: serveOpenAI,
       config: { visibility: "public" }
     });
     ```

2. **Service URL Structure**
   - Service accessible at: `{server_url}/{workspace}/apps/{service_id}/v1/chat/completions`
   - Example: `https://hypha.aicell.io/my-workspace/apps/code-agent/v1/chat/completions`
   - Fully OpenAI-compatible endpoint

3. **Request/Response Format**
   ```typescript
   // Request (OpenAI-compatible)
   interface ChatCompletionRequest {
     model: string;
     messages: ChatMessage[];
     temperature?: number;
     stream?: boolean;
     tools?: Tool[];
   }

   // Response (streaming with SSE)
   interface ChatCompletionChunk {
     id: string;
     object: "chat.completion.chunk";
     created: number;
     model: string;
     choices: [{
       delta: { role?: string; content?: string };
       index: number;
       finish_reason: string | null;
     }];
   }
   ```

4. **Streaming Response via ASGI**
   - Use ASGI `send()` function to stream chunks
   - Format chunks as Server-Sent Events (SSE)
   - Example:
     ```
     data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"},...}]}

     data: {"id":"chatcmpl-123","choices":[{"delta":{"content":" world"},...}]}

     data: [DONE]
     ```
    

5. **Authentication**
   - Use Hypha token-based authentication
   - Pass token via `Authorization: Bearer <token>` header
   - Context includes user information for authorization

**Key Implementation Notes:**
- ASGI service handles all HTTP concerns automatically
- No need for manual server setup or port management
- Streaming works natively through ASGI protocol
- Service is immediately accessible via public URL

### Phase 7: Integration & Testing

1. **Integration Testing**
   - Test kernel execution with various Python code
   - Test agent with different prompts
   - Test Hypha service registration and discovery
   - Test streaming responses
   - Test error handling and recovery

2. **End-to-End Workflow**
   - User opens the web interface
   - Connects to Hypha server
   - Service registers automatically
   - User sends query via terminal
   - Agent thinks, writes code, executes via kernel
   - Results stream back to terminal
   - User can follow up with more queries

3. **Example Usage Scenarios**
   - Data analysis: "Analyze this CSV file and plot trends"
   - Mathematical computation: "Solve this differential equation"
   - Image processing: "Load and apply filters to this image"
   - Web scraping: "Fetch and parse this website"

### Phase 8: Deployment & Documentation

1. **Build for Production**
   ```bash
   pnpm run build
   ```

2. **Deployment Options**
   - Static hosting (GitHub Pages, Netlify)
   - Docker container
   - Self-hosted on local server

3. **Documentation**
   - Setup guide
   - API reference (OpenAI-compatible)
   - Example usage patterns
   - Hypha integration guide
   - MCP server configuration

4. **Configuration File**
   ```json
   {
     "serverUrl": "https://hypha.aicell.io",
     "workspace": "my-workspace",
     "serviceId": "code-agent",
     "llm": {
       "baseURL": "http://localhost:11434/v1/",
       "model": "qwen2.5-coder:7b",
       "temperature": 0.7
     }
   }
   ```

## Key Design Principles

1. **Async Everything**
   - All operations are async
   - Use async generators for streaming
   - Proper error handling with try/catch

2. **Streaming First**
   - Stream LLM responses as they arrive
   - Stream code execution outputs
   - Provide real-time feedback to users

3. **Modular Architecture**
   - Separate concerns: kernel, agent, service, UI
   - Easy to test and maintain
   - Pluggable components

4. **OpenAI Compatibility**
   - Follow OpenAI API conventions
   - Easy to swap LLM providers
   - Standard tool calling format

5. **Hypha Integration**
   - Leverage Hypha's service discovery
   - Use MCP for standardized tool exposure
   - Support workspace isolation

## Technical Considerations

1. **Browser Limitations**
   - Python runs in WebAssembly (Pyodide)
   - No native file system access (use File System Access API)
   - Limited to pure Python packages or WASM-compiled ones
   - Memory constraints (~2GB typical)

2. **Security**
   - Code execution is sandboxed in browser
   - Hypha token-based authentication
   - No server-side code execution risks

3. **Performance**
   - First kernel load may be slow (~10-20s)
   - Subsequent executions are fast
   - Use worker mode for better isolation
   - Consider kernel pooling for multi-user scenarios

4. **Error Handling**
   - Graceful degradation on errors
   - Clear error messages to users
   - Automatic retry for transient failures
   - Kernel restart on crashes
