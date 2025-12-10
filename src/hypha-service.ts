// Hypha Service Registration and Management
import type { AgentSettings } from './settings';
import type { KernelManager } from './kernel';
import type { AgentManager } from './agent';

export interface HyphaServiceConfig {
  serverUrl: string;
  workspace: string;
  token?: string;
  serviceId?: string;
  visibility?: 'public' | 'protected';
}

export class HyphaService {
  private server: any = null;
  private serviceId: string | null = null;
  private serviceUrl: string | null = null;
  private onOutput: (message: string, type?: string) => void;
  private kernelManager: KernelManager;
  private agentManager: AgentManager | null;
  private settings: AgentSettings;

  constructor(
    settings: AgentSettings,
    kernelManager: KernelManager,
    agentManager: AgentManager | null,
    onOutput: (message: string, type?: string) => void
  ) {
    this.settings = settings;
    this.kernelManager = kernelManager;
    this.agentManager = agentManager;
    this.onOutput = onOutput;
  }

  updateSettings(settings: AgentSettings): void {
    this.settings = settings;
  }

  updateAgentManager(agentManager: AgentManager): void {
    this.agentManager = agentManager;
  }

  isConnected(): boolean {
    return this.server !== null;
  }

  getServiceInfo(): { serviceId: string | null; serviceUrl: string | null } {
    return {
      serviceId: this.serviceId,
      serviceUrl: this.serviceUrl
    };
  }

  async connect(config: HyphaServiceConfig): Promise<void> {
    if (this.server) {
      this.onOutput('Already connected to Hypha server', 'info');
      return;
    }

    this.onOutput('Loading Hypha RPC client...', 'info');

    try {
      // Load Hypha RPC client dynamically
      if (!(window as any).hyphaWebsocketClient) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.79/dist/hypha-rpc-websocket.min.js';
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        this.onOutput('✓ Hypha RPC client loaded', 'info');
      }

      const hyphaClient = (window as any).hyphaWebsocketClient;

      // Handle authentication
      let token = config.token;

      if (!token || this.isTokenExpired(token)) {
        if (token) {
          this.onOutput('Token expired, requesting new token...', 'info');
        } else {
          this.onOutput('No token provided, initiating login...', 'info');
        }

        token = await hyphaClient.login({
          server_url: config.serverUrl,
          login_callback: (context: any) => {
            this.onOutput(`Please open login URL: ${context.login_url}`, 'info');
            window.open(context.login_url, '_blank');
          },
          workspace: config.workspace
        });
      }

      // Connect to Hypha server
      const connectionConfig: any = {
        server_url: config.serverUrl,
        workspace: config.workspace,
        token: token
      };

      this.server = await hyphaClient.connectToServer(connectionConfig);

      this.onOutput(`✓ Connected to Hypha server at ${config.serverUrl}`, 'info');
      this.onOutput(`Workspace: ${this.server.config.workspace}`, 'info');

      // Register the code agent service
      await this.registerService(config);

    } catch (error) {
      this.onOutput(`Hypha connection error: ${(error as Error).message}`, 'error');
      console.error('Hypha connection error:', error);
      throw error;
    }
  }

  private isTokenExpired(token: string): boolean {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const payload = JSON.parse(jsonPayload);

      if (!payload || !payload.exp) return true;

      const expirationTime = payload.exp * 1000;
      return Date.now() > expirationTime;
    } catch (error) {
      return true;
    }
  }

  private async registerService(config: HyphaServiceConfig): Promise<void> {
    if (!this.server) {
      throw new Error('Server not connected');
    }

    const serviceId = config.serviceId || 'hypha-code-agent';
    const visibility = config.visibility || 'protected';

    this.onOutput(`Registering code agent service (ID: ${serviceId}, visibility: ${visibility})...`, 'info');

    try {
      // Define service schema for chat completion
      const chatCompletionSchema = {
        name: 'chatCompletion',
        description: 'OpenAI-compatible chat completion endpoint with code execution capabilities. Supports streaming responses and tool calling for Python code execution.',
        parameters: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              description: 'Array of chat messages in OpenAI format',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant', 'system', 'tool'] },
                  content: { type: 'string' }
                }
              }
            },
            model: {
              type: 'string',
              description: 'Model name to use (configured in settings)'
            },
            temperature: {
              type: 'number',
              description: 'Sampling temperature (0-2)'
            },
            stream: {
              type: 'boolean',
              description: 'Whether to stream the response'
            },
            max_steps: {
              type: 'number',
              description: 'Maximum reasoning steps for React loop'
            }
          },
          required: ['messages']
        }
      };

      const executeCodeSchema = {
        name: 'executeCode',
        description: 'Execute Python code directly in the browser-based Python kernel',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Python code to execute'
            }
          },
          required: ['code']
        }
      };

      const getServiceInfoSchema = {
        name: 'getServiceInfo',
        description: 'Get information about the code agent service',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      };

      // Register service with MCP type
      const service = await this.server.registerService({
        type: 'mcp',
        id: serviceId,
        name: 'Hypha Code Agent',
        description: 'AI-powered code agent with Python kernel execution capabilities. Provides OpenAI-compatible chat completion API with integrated code execution in a browser-based Python environment.',
        config: {
          visibility: visibility,
          require_context: true
        },

        // Chat completion endpoint (OpenAI-compatible)
        chatCompletion: Object.assign(
          async ({ messages, model, temperature, stream = true, max_steps }: any, context?: any) => {
            if (!this.agentManager) {
              throw new Error('Agent manager not initialized');
            }

            this.onOutput(`🌐 Remote call: chatCompletion() - Processing ${messages.length} messages`, 'info');

            // Use the agent manager's processQueryInReactLoop for handling the chat
            const maxSteps = max_steps || this.settings.maxSteps;
            const userMessage = messages[messages.length - 1]?.content || '';

            try {
              await this.agentManager.processQueryInReactLoop(userMessage, maxSteps);
              return { success: true, message: 'Query processed successfully' };
            } catch (error) {
              this.onOutput(`Chat completion error: ${(error as Error).message}`, 'error');
              throw error;
            }
          },
          { __schema__: chatCompletionSchema }
        ),

        // Direct code execution
        executeCode: Object.assign(
          async ({ code }: { code: string }, context?: any) => {
            this.onOutput(`🌐 Remote call: executeCode() - Executing ${code.length} chars`, 'info');

            if (!this.kernelManager.isInitialized()) {
              throw new Error('Kernel not initialized');
            }

            try {
              const result = await this.kernelManager.executeCode(code);
              this.onOutput(`✓ Code execution completed`, 'info');
              return result;
            } catch (error) {
              this.onOutput(`Code execution error: ${(error as Error).message}`, 'error');
              throw error;
            }
          },
          { __schema__: executeCodeSchema }
        ),

        // Service info
        getServiceInfo: Object.assign(
          async (context?: any) => {
            this.onOutput(`🌐 Remote call: getServiceInfo()`, 'info');

            return {
              name: 'Hypha Code Agent',
              version: '0.1.0',
              features: {
                chatCompletion: true,
                codeExecution: true,
                streaming: true,
                reactLoop: true
              },
              settings: {
                model: this.settings.openaiModel,
                provider: this.settings.openaiProvider,
                maxSteps: this.settings.maxSteps
              },
              kernelStatus: this.kernelManager.isInitialized() ? 'ready' : 'not_initialized'
            };
          },
          { __schema__: getServiceInfoSchema }
        )
      });

      // Store service info
      this.serviceId = service.id;

      // Build service URL
      const workspace = this.server.config.workspace;
      const serverUrl = config.serverUrl;
      const actualServiceId = service.id.split('/')[1];  // Extract "client_id:service_name"

      this.serviceUrl = `${serverUrl}/${workspace}/services/${actualServiceId}`;
      const mcpUrl = `${serverUrl}/${workspace}/mcp/${actualServiceId}/mcp`;

      this.onOutput('✓ Code agent service registered successfully', 'info');
      this.onOutput(`Service ID: ${this.serviceId}`, 'info');
      this.onOutput(`Service URL: ${this.serviceUrl}`, 'info');
      this.onOutput(`MCP URL: ${mcpUrl}`, 'info');

    } catch (error) {
      this.onOutput(`Service registration error: ${(error as Error).message}`, 'error');
      console.error('Service registration error:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.server) {
      this.onOutput('Not connected to Hypha server', 'info');
      return;
    }

    try {
      // Disconnect from server
      await this.server.disconnect();
      this.server = null;
      this.serviceId = null;
      this.serviceUrl = null;

      this.onOutput('✓ Disconnected from Hypha server', 'info');
    } catch (error) {
      this.onOutput(`Disconnect error: ${(error as Error).message}`, 'error');
      throw error;
    }
  }
}
