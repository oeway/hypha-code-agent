// Hypha Service Registration and Management
import type { AgentSettings } from './settings';
import type { KernelManager } from './kernel';
import type { AgentManager } from './agent';

export interface HyphaServiceConfig {
  serverUrl: string;
  workspace: string;
  token?: string;
  clientId?: string;
  serviceId?: string;
  visibility?: 'public' | 'protected';
}

interface Job {
  id: string;
  type: 'chat' | 'code';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  submittedAt: number;
  startedAt?: number;
  completedAt?: number;
  input: any;
  result?: any;
  error?: string;
}

export interface InstalledService {
  id: string;
  name: string;
  description: string;
  serviceUrl: string;
  // Functions/methods available in this service
  functions?: Array<{
    name: string;
    description: string;
    parameters?: any;
  }>;
  // Full service schema (for generating system prompts)
  schema?: any;
}

export class HyphaService {
  private server: any = null;
  private serviceId: string | null = null;
  private serviceUrl: string | null = null;
  private onOutput: (message: string, type?: string) => void;
  private kernelManager: KernelManager;
  private agentManager: AgentManager | null;
  private settings: AgentSettings;

  // Job queue system
  private jobs: Map<string, Job> = new Map();
  private jobQueue: string[] = [];
  private isProcessingQueue: boolean = false;

  // Service installation system
  private installedServices: InstalledService[] = [];
  private servicePrompt: string = '';
  private baseSystemPrompt: string = ''; // Store the base prompt without service info

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
    // Store the base system prompt (without service info)
    if (settings.systemPrompt) {
      this.baseSystemPrompt = settings.systemPrompt;
    }
    // Update combined prompt with services
    this.updateCombinedSystemPrompt();
  }

  updateAgentManager(agentManager: AgentManager): void {
    this.agentManager = agentManager;
  }

  /**
   * Update the system prompt in settings to include service information
   * This keeps AgentManager agnostic to HyphaService
   */
  private updateCombinedSystemPrompt(): void {
    let combinedPrompt = this.baseSystemPrompt;

    // Append service prompt if services are installed
    if (this.servicePrompt) {
      combinedPrompt = combinedPrompt
        ? `${combinedPrompt}\n\n${this.servicePrompt}`
        : this.servicePrompt;
    }

    // Update settings with combined prompt
    this.settings = {
      ...this.settings,
      systemPrompt: combinedPrompt
    };

    // Update agent manager with new settings
    if (this.agentManager) {
      this.agentManager.updateSettings(this.settings);
    }
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

      // Handle authentication - check localStorage first
      let token = config.token;

      // Try to get token from localStorage
      if (!token) {
        const savedToken = localStorage.getItem('hypha_token');
        const tokenExpiry = localStorage.getItem('hypha_token_expiry');

        if (savedToken && tokenExpiry && new Date(tokenExpiry) > new Date()) {
          token = savedToken;
          this.onOutput('Using saved authentication token', 'info');
        }
      }

      // If still no token or token is expired, initiate login
      if (!token || this.isTokenExpired(token)) {
        if (token) {
          this.onOutput('Token expired, requesting new token...', 'info');
          // Clear expired token
          localStorage.removeItem('hypha_token');
          localStorage.removeItem('hypha_token_expiry');
        } else {
          this.onOutput('No token provided, initiating login...', 'info');
        }

        // Login to get token
        const loginConfig: any = {
          server_url: config.serverUrl,
          login_callback: (context: any) => {
            this.onOutput(`Please open login URL: ${context.login_url}`, 'info');
            window.open(context.login_url, '_blank');
          }
        };

        token = await hyphaClient.login(loginConfig);

        // Save token to localStorage with 3-hour expiry
        if (token) {
          localStorage.setItem('hypha_token', token);
          const expiry = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
          localStorage.setItem('hypha_token_expiry', expiry);
          this.onOutput('✓ Login successful, token saved', 'info');
        }
      }

      // Connect to Hypha server
      // Normalize workspace: convert empty string to null
      const workspace = config.workspace && config.workspace.trim() !== '' ? config.workspace : null;

      const connectionConfig: any = {
        server_url: config.serverUrl,
        method_timeout: 180
      };
      // Only add token if not null
      if (token) {
        connectionConfig.token = token;
      }

      // Only add workspace if it's not null
      if (workspace) {
        connectionConfig.workspace = workspace;
      }

      // Add client_id if provided
      if (config.clientId) {
        connectionConfig.client_id = config.clientId;
      }

      this.server = await hyphaClient.connectToServer(connectionConfig);

      this.onOutput(`✓ Connected to Hypha server at ${config.serverUrl}`, 'info');
      this.onOutput(`Workspace: ${this.server.config.workspace}`, 'info');

      // Fallback to server environment variables if credentials not provided
      let baseUrl = this.settings.openaiBaseUrl;
      let apiKey = this.settings.openaiApiKey;

      if (!baseUrl || !apiKey) {
        try {
          if (!baseUrl) {
            const envBaseUrl = await this.server.getEnv('OPENAI_BASE_URL');
            if (envBaseUrl) {
              baseUrl = envBaseUrl;
              this.onOutput('✓ Using OPENAI_BASE_URL from Hypha server environment', 'info');
            }
          }

          if (!apiKey) {
            const envApiKey = await this.server.getEnv('OPENAI_API_KEY');
            if (envApiKey) {
              apiKey = envApiKey;
              this.onOutput('✓ Using OPENAI_API_KEY from Hypha server environment', 'info');
            }
          }

          // Update settings with environment values
          if (baseUrl !== this.settings.openaiBaseUrl || apiKey !== this.settings.openaiApiKey) {
            this.settings = {
              ...this.settings,
              openaiBaseUrl: baseUrl,
              openaiApiKey: apiKey
            };

            // Update agent manager with new settings
            if (this.agentManager) {
              this.agentManager.updateSettings(this.settings);
            }
          }
        } catch (error) {
          this.onOutput(`Could not fetch environment variables from server: ${(error as Error).message}`, 'info');
        }
      }

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

      // Register service with MCP type
      const service = await this.server.registerService({
        type: 'agent',
        id: serviceId,
        name: 'Hypha Code Agent',
        description: 'AI-powered code agent with Python kernel execution capabilities. Provides OpenAI-compatible chat completion API with integrated code execution in a browser-based Python environment.',
        config: {
          visibility: visibility,
          require_context: true
        },

        // Chat completion endpoint (OpenAI-compatible)
        chatCompletion: Object.assign(
          async ({ messages, model: _model, temperature: _temperature, stream: _stream = true, max_steps }: any, _context?: any) => {
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
          async ({ code }: { code: string }, _context?: any) => {
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

        // Update agent settings
        updateSettings: Object.assign(
          async ({ settings }: { settings: Partial<AgentSettings> }, _context?: any) => {
            this.onOutput(`🌐 Remote call: updateSettings()`, 'info');

            try {
              // Update local settings
              const currentSettings = this.settings;
              const newSettings = { ...currentSettings, ...settings };
              this.settings = newSettings;

              // Update agent manager if available
              if (this.agentManager) {
                this.agentManager.updateSettings(newSettings);
              }

              this.onOutput(`✓ Settings updated successfully`, 'info');
              return { success: true, message: 'Settings updated' };
            } catch (error) {
              this.onOutput(`Update settings error: ${(error as Error).message}`, 'error');
              throw error;
            }
          },
          {
            __schema__: {
              name: 'updateSettings',
              description: 'Update agent settings',
              parameters: {
                type: 'object',
                properties: {
                  settings: {
                    type: 'object',
                    description: 'Partial agent settings to update'
                  }
                },
                required: ['settings']
              }
            }
          }
        ),

        // Get conversation history
        getConversation: Object.assign(
          async (_params: any, _context?: any) => {
            this.onOutput(`🌐 Remote call: getConversation()`, 'info');

            if (!this.agentManager) {
              throw new Error('Agent manager not initialized');
            }

            try {
              const history = this.agentManager.getConversationHistory();
              this.onOutput(`✓ Retrieved ${history.length} conversation messages`, 'info');
              return { success: true, history };
            } catch (error) {
              this.onOutput(`Get conversation error: ${(error as Error).message}`, 'error');
              throw error;
            }
          },
          {
            __schema__: {
              name: 'getConversation',
              description: 'Get the current conversation history',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          }
        ),

        // Clear conversation history
        clearConversation: Object.assign(
          async (_params: any, _context?: any) => {
            this.onOutput(`🌐 Remote call: clearConversation()`, 'info');

            if (!this.agentManager) {
              throw new Error('Agent manager not initialized');
            }

            try {
              this.agentManager.clearHistory();
              this.onOutput(`✓ Conversation history cleared`, 'info');
              return { success: true, message: 'Conversation cleared' };
            } catch (error) {
              this.onOutput(`Clear conversation error: ${(error as Error).message}`, 'error');
              throw error;
            }
          },
          {
            __schema__: {
              name: 'clearConversation',
              description: 'Clear the conversation history',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          }
        ),

        // Submit chat job (async with job ID)
        submitChatJob: Object.assign(
          async ({ messages, max_steps }: { messages: any[]; max_steps?: number }, _context?: any) => {
            this.onOutput(`🌐 Remote call: submitChatJob()`, 'info');
            const jobId = this.submitChatJob(messages, max_steps);
            return { jobId };
          },
          {
            __schema__: {
              name: 'submitChatJob',
              description: 'Submit a chat completion job and return immediately with a job ID',
              parameters: {
                type: 'object',
                properties: {
                  messages: {
                    type: 'array',
                    description: 'Array of chat messages'
                  },
                  max_steps: {
                    type: 'number',
                    description: 'Maximum reasoning steps'
                  }
                },
                required: ['messages']
              }
            }
          }
        ),

        // Submit code execution job (async with job ID)
        submitCodeJob: Object.assign(
          async ({ code }: { code: string }, _context?: any) => {
            this.onOutput(`🌐 Remote call: submitCodeJob()`, 'info');
            const jobId = this.submitCodeJob(code);
            return { jobId };
          },
          {
            __schema__: {
              name: 'submitCodeJob',
              description: 'Submit a code execution job and return immediately with a job ID',
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
            }
          }
        ),

        // Get job status
        getJobStatus: Object.assign(
          async ({ jobId }: { jobId: string }, _context?: any) => {
            this.onOutput(`🌐 Remote call: getJobStatus(${jobId})`, 'info');
            const job = this.getJobStatus(jobId);
            if (!job) {
              throw new Error(`Job not found: ${jobId}`);
            }
            return job;
          },
          {
            __schema__: {
              name: 'getJobStatus',
              description: 'Get the status of a submitted job',
              parameters: {
                type: 'object',
                properties: {
                  jobId: {
                    type: 'string',
                    description: 'The job ID to check'
                  }
                },
                required: ['jobId']
              }
            }
          }
        ),

        // Cancel job
        cancelJob: Object.assign(
          async ({ jobId }: { jobId: string }, _context?: any) => {
            this.onOutput(`🌐 Remote call: cancelJob(${jobId})`, 'info');
            const cancelled = this.cancelJob(jobId);
            return { success: cancelled, message: cancelled ? 'Job cancelled' : 'Cannot cancel job (not queued or not found)' };
          },
          {
            __schema__: {
              name: 'cancelJob',
              description: 'Cancel a queued job by its ID',
              parameters: {
                type: 'object',
                properties: {
                  jobId: {
                    type: 'string',
                    description: 'The job ID to cancel'
                  }
                },
                required: ['jobId']
              }
            }
          }
        ),

        // List all jobs
        listJobs: Object.assign(
          async (_params: any, _context?: any) => {
            this.onOutput(`🌐 Remote call: listJobs()`, 'info');
            const jobs = this.listJobs();
            return { jobs };
          },
          {
            __schema__: {
              name: 'listJobs',
              description: 'List all jobs (queued, running, completed, failed, cancelled)',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          }
        ),

        // Install a Hypha service
        installService: Object.assign(
          async ({ serviceUrl }: { serviceUrl: string }, _context?: any) => {
            this.onOutput(`🌐 Remote call: installService(${serviceUrl})`, 'info');
            const service = await this.installService(serviceUrl);
            return { success: true, service };
          },
          {
            __schema__: {
              name: 'installService',
              description: 'Install a Hypha service by fetching its schema and metadata',
              parameters: {
                type: 'object',
                properties: {
                  serviceUrl: {
                    type: 'string',
                    description: 'Full service URL (e.g., https://hypha.aicell.io/workspace/services/client:service)'
                  }
                },
                required: ['serviceUrl']
              }
            }
          }
        ),

        // Remove an installed service
        removeService: Object.assign(
          async ({ serviceId }: { serviceId: string }, _context?: any) => {
            this.onOutput(`🌐 Remote call: removeService(${serviceId})`, 'info');
            const removed = this.removeService(serviceId);
            return { success: removed, message: removed ? 'Service removed' : 'Service not found' };
          },
          {
            __schema__: {
              name: 'removeService',
              description: 'Remove an installed service by its ID',
              parameters: {
                type: 'object',
                properties: {
                  serviceId: {
                    type: 'string',
                    description: 'The service ID to remove'
                  }
                },
                required: ['serviceId']
              }
            }
          }
        ),

        // List installed services
        listInstalledServices: Object.assign(
          async (_params: any, _context?: any) => {
            this.onOutput(`🌐 Remote call: listInstalledServices()`, 'info');
            const services = this.getInstalledServices();
            return { services };
          },
          {
            __schema__: {
              name: 'listInstalledServices',
              description: 'Get list of all installed Hypha services',
              parameters: {
                type: 'object',
                properties: {}
              }
            }
          }
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

  // Job Queue Management Methods

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private async processJobQueue(): Promise<void> {
    if (this.isProcessingQueue || this.jobQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.jobQueue.length > 0) {
      const jobId = this.jobQueue[0];
      const job = this.jobs.get(jobId);

      if (!job || job.status === 'cancelled') {
        this.jobQueue.shift();
        continue;
      }

      // Update job status
      job.status = 'running';
      job.startedAt = Date.now();
      this.onOutput(`[Job ${jobId}] Started processing`, 'info');

      try {
        if (job.type === 'chat') {
          // Process chat completion
          const { messages, max_steps } = job.input;
          const maxSteps = max_steps || this.settings.maxSteps;
          const userMessage = messages[messages.length - 1]?.content || '';

          if (!this.agentManager) {
            throw new Error('Agent manager not initialized');
          }

          await this.agentManager.processQueryInReactLoop(userMessage, maxSteps);
          job.result = { success: true, message: 'Query processed successfully' };
        } else if (job.type === 'code') {
          // Process code execution
          const { code } = job.input;

          if (!this.kernelManager.isInitialized()) {
            throw new Error('Kernel not initialized');
          }

          const result = await this.kernelManager.executeCode(code);
          job.result = result;
        }

        job.status = 'completed';
        job.completedAt = Date.now();
        this.onOutput(`[Job ${jobId}] Completed`, 'info');
      } catch (error) {
        job.status = 'failed';
        job.completedAt = Date.now();
        job.error = (error as Error).message;
        this.onOutput(`[Job ${jobId}] Failed: ${job.error}`, 'error');
      }

      // Remove from queue
      this.jobQueue.shift();
    }

    this.isProcessingQueue = false;
  }

  submitChatJob(messages: any[], max_steps?: number): string {
    const jobId = this.generateJobId();
    const job: Job = {
      id: jobId,
      type: 'chat',
      status: 'queued',
      submittedAt: Date.now(),
      input: { messages, max_steps }
    };

    this.jobs.set(jobId, job);
    this.jobQueue.push(jobId);
    this.onOutput(`[Job ${jobId}] Queued (chat completion)`, 'info');

    // Start processing queue
    this.processJobQueue().catch((error) => {
      console.error('Job queue processing error:', error);
    });

    return jobId;
  }

  submitCodeJob(code: string): string {
    const jobId = this.generateJobId();
    const job: Job = {
      id: jobId,
      type: 'code',
      status: 'queued',
      submittedAt: Date.now(),
      input: { code }
    };

    this.jobs.set(jobId, job);
    this.jobQueue.push(jobId);
    this.onOutput(`[Job ${jobId}] Queued (code execution)`, 'info');

    // Start processing queue
    this.processJobQueue().catch((error) => {
      console.error('Job queue processing error:', error);
    });

    return jobId;
  }

  getJobStatus(jobId: string): Job | null {
    return this.jobs.get(jobId) || null;
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.completedAt = Date.now();
      this.onOutput(`[Job ${jobId}] Cancelled`, 'info');
      return true;
    }

    // Cannot cancel running or completed jobs
    return false;
  }

  listJobs(): Job[] {
    return Array.from(this.jobs.values()).sort((a, b) => a.submittedAt - b.submittedAt);
  }

  // Service Installation Management Methods

  /**
   * Install a Hypha service by fetching its schema and metadata
   * @param serviceUrl - Full service URL (e.g., https://hypha.aicell.io/workspace/services/client:service)
   */
  async installService(serviceUrl: string): Promise<InstalledService> {
    if (!this.server) {
      throw new Error('Server not connected. Please connect to a Hypha server first.');
    }

    try {
      this.onOutput(`[Service Install] Fetching service: ${serviceUrl}`, 'info');

      // Parse the service URL
      let targetServer = this.server;
      let serviceQuery = serviceUrl;

      // Check if it's a full URL
      if (serviceUrl.startsWith('http://') || serviceUrl.startsWith('https://')) {
        const url = new URL(serviceUrl);
        const pathParts = url.pathname.split('/').filter(p => p);

        // Expected format: /workspace/services/clientId:serviceId or /workspace/clientId:serviceId
        if (pathParts.length < 2) {
          throw new Error('Invalid service URL format. Expected: https://server/workspace/[services/]clientId:serviceId');
        }

        // Decode workspace (may contain URL-encoded characters)
        const workspace = decodeURIComponent(pathParts[0]);

        // Find the part with the colon (clientId:serviceId)
        const servicePartIndex = pathParts.findIndex(p => p.includes(':'));
        if (servicePartIndex === -1) {
          throw new Error('Invalid service URL format. Service ID must be in format clientId:serviceId');
        }

        // Decode the service part before splitting
        const servicePart = decodeURIComponent(pathParts[servicePartIndex]);
        const [clientId, serviceId] = servicePart.split(':');

        if (!clientId || !serviceId) {
          throw new Error('Invalid service format. Expected format: clientId:serviceId');
        }

        // Construct the service query: workspace/clientId:serviceId
        // Parts are already decoded, so no need to decode again
        serviceQuery = `${workspace}/${clientId}:${serviceId}`;

        this.onOutput(`[Service Install] Parsed: ${serviceQuery}`, 'info');

        // For simplicity, we'll use the current server connection
        // In hypha-agents, they connect to different servers if needed
        // For now, we assume services are on the same server
      }

      // Fetch the actual service from Hypha server
      const service = await targetServer.getService(serviceQuery);

      if (!service) {
        throw new Error(`Service not found: ${serviceQuery}`);
      }

      // Get the service schema and metadata via HTTP GET request
      let schema: any = null;
      let functions: InstalledService['functions'] = [];
      let serviceName = '';
      let serviceDescription = '';

      // Extract service ID from the query (for display purposes)
      const displayServiceId = serviceQuery.includes(':')
        ? serviceQuery.split(':').pop() || serviceQuery
        : serviceQuery.split('/').pop() || serviceQuery;

      try {
        this.onOutput(`[Service Install] Fetching schema via HTTP: ${serviceUrl}`, 'info');
        const response = await fetch(serviceUrl);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const serviceData = await response.json();

        // Get name and description
        serviceName = serviceData.name || service.name || service.id || displayServiceId;
        serviceDescription = serviceData.description || service.description || 'Hypha service';

        // Get schema
        if (serviceData.service_schema) {
          schema = serviceData.service_schema;
          this.onOutput(`[Service Install] Got service_schema with ${Object.keys(schema).length} functions`, 'info');

          // Extract function information from schema
          if (typeof schema === 'object') {
            // Schema can be an array of tool definitions or an object with tool definitions
            const toolDefinitions = Array.isArray(schema) ? schema : Object.values(schema);

            functions = toolDefinitions.map((tool: any) => {
              if (tool.function) {
                return {
                  name: tool.function.name || 'unknown',
                  description: tool.function.description || '',
                  parameters: tool.function.parameters || {}
                };
              }
              return null;
            }).filter(Boolean) as InstalledService['functions'];
          }
        } else {
          this.onOutput('[Service Install] No service_schema found in HTTP response', 'info');
        }
      } catch (error) {
        this.onOutput(`[Service Install] Error fetching schema via HTTP: ${(error as Error).message}`, 'info');
        // Fallback to service object
        serviceName = service.name || service.id || displayServiceId;
        serviceDescription = service.description || 'Hypha service';
      }

      const newService: InstalledService = {
        id: displayServiceId,
        name: serviceName,
        description: serviceDescription,
        serviceUrl: serviceUrl,
        functions: functions,
        schema: schema
      };

      // Check if already exists
      if (this.installedServices.some(s => s.serviceUrl === serviceUrl)) {
        throw new Error(`Service "${serviceName}" is already installed`);
      }

      // Add to installed services
      this.installedServices.push(newService);

      // Regenerate service prompt and update agent settings
      this.servicePrompt = this.generateServicePrompt(this.installedServices);
      this.updateCombinedSystemPrompt();

      this.onOutput(`[Service Install] Successfully installed: ${serviceName}`, 'info');

      return newService;
    } catch (error) {
      this.onOutput(`[Service Install] Error: ${(error as Error).message}`, 'error');
      throw error;
    }
  }

  /**
   * Remove an installed service by its ID
   * @param serviceId - The service ID to remove
   */
  removeService(serviceId: string): boolean {
    const serviceToRemove = this.installedServices.find(s => s.id === serviceId);

    if (!serviceToRemove) {
      this.onOutput(`[Service Remove] Service not found: ${serviceId}`, 'info');
      return false;
    }

    // Remove from installed services
    this.installedServices = this.installedServices.filter(s => s.id !== serviceId);

    // Regenerate service prompt and update agent settings
    this.servicePrompt = this.generateServicePrompt(this.installedServices);
    this.updateCombinedSystemPrompt();

    this.onOutput(`[Service Remove] Removed service: ${serviceId}`, 'info');
    return true;
  }

  /**
   * Get list of installed services
   */
  getInstalledServices(): InstalledService[] {
    return [...this.installedServices];
  }

  /**
   * Get the generated service prompt
   */
  getServicePrompt(adHocServiceIds?: string[]): string {
    // If ad-hoc services are provided, generate a combined prompt
    if (adHocServiceIds && adHocServiceIds.length > 0) {
      // For now, just return the base prompt
      // In a full implementation, we would fetch and include ad-hoc services
      this.onOutput(`[Service Prompt] Ad-hoc services requested: ${adHocServiceIds.join(', ')}`, 'info');
      return this.servicePrompt;
    }
    return this.servicePrompt;
  }

  /**
   * Generate service prompt from installed services
   * Based on hypha-agents environmentPrompt pattern
   */
  private generateServicePrompt(services: InstalledService[]): string {
    if (services.length === 0) {
      return '';
    }

    let prompt = '';

    prompt += '---\n\n';
    prompt += '## 🔌 INSTALLED HYPHA SERVICES\n\n';
    prompt += `**You have ${services.length} external Hypha service${services.length > 1 ? 's' : ''} installed** that provide additional capabilities beyond Python code execution.\n\n`;

    // Add general instructions for using Hypha services
    prompt += '### How to Connect to Hypha and Use Services\n\n';
    prompt += '**IMPORTANT**: To use Hypha services, you first need to connect to the Hypha server in Python.\n\n';

    prompt += '#### Step 1: Install Required Packages and Connect\n\n';
    prompt += '```python\n';
    prompt += '# Install required packages (only needed once per session)\n';
    prompt += 'import micropip\n';
    prompt += 'await micropip.install(["imjoy-rpc", "pyodide-http"])\n\n';
    prompt += '# Patch HTTP for Pyodide\n';
    prompt += 'import pyodide_http\n';
    prompt += 'pyodide_http.patch_all()\n\n';
    prompt += '# Import and connect to Hypha\n';
    prompt += 'from imjoy_rpc.hypha import connect_to_server\n\n';
    prompt += '# Connect to the Hypha server\n';
    prompt += 'server = await connect_to_server({\n';
    prompt += '    "server_url": "https://hypha.aicell.io",\n';
    prompt += '    "workspace": "your-workspace-name",  # Optional: specify workspace\n';
    prompt += '    "token": "your-token"  # Optional: for authentication\n';
    prompt += '})\n\n';
    prompt += 'print(f"Connected to Hypha server: {server.config.workspace}")\n';
    prompt += '```\n\n';

    prompt += '**Note**: After connecting once, the `server` object is available for the rest of the session.\n\n';

    prompt += '#### Step 2: Use Hypha Services\n\n';
    prompt += 'Once connected, you can access any Hypha service:\n\n';
    prompt += '```python\n';
    prompt += '# Get a service by its ID\n';
    prompt += 'my_service = await server.get_service("workspace/client-id:service-id")\n\n';
    prompt += '# Call service functions (always use await)\n';
    prompt += 'result = await my_service.some_function(param1="value", param2=123)\n';
    prompt += 'print(result)\n';
    prompt += '```\n\n';

    prompt += '**CRITICAL**: All service calls are asynchronous and MUST use `await`!\n\n';

    prompt += '### Available Services\n\n';
    prompt += 'Below are the detailed specifications for each installed service:\n\n';

    // List each service with its tools
    services.forEach((service, index) => {
      prompt += `#### Service ${index + 1}: ${service.name}\n\n`;
      if (service.description) {
        prompt += `**Description**: ${service.description}\n\n`;
      }

      // Parse service URL to get the service ID for get_service call
      let serviceId = service.serviceUrl;
      if (service.serviceUrl.startsWith('http://') || service.serviceUrl.startsWith('https://')) {
        try {
          const url = new URL(service.serviceUrl);
          const pathParts = url.pathname.split('/').filter(p => p);
          // Decode workspace and service part (may contain URL-encoded characters)
          const workspace = decodeURIComponent(pathParts[0]);
          const servicePart = pathParts.find(p => p.includes(':'));
          if (workspace && servicePart) {
            // Decode service part before constructing serviceId
            serviceId = `${workspace}/${decodeURIComponent(servicePart)}`;
          }
        } catch (e) {
          // Keep original serviceUrl if parsing fails
        }
      }

      prompt += `**Service ID**: \`${serviceId}\`\n\n`;
      prompt += '**How to get this service**:\n';
      prompt += '```python\n';
      prompt += `${service.id.replace(/-/g, '_')} = await server.get_service("${serviceId}")\n`;
      prompt += '```\n\n';

      // Show the complete service_schema
      if (service.schema) {
        // Convert array schema back to object format for display (if it's an array)
        let schemaToDisplay = service.schema;
        if (Array.isArray(service.schema)) {
          // Convert array to object with function names as keys
          schemaToDisplay = {};
          service.schema.forEach((tool: any) => {
            if (tool.function?.name) {
              schemaToDisplay[tool.function.name] = tool;
            }
          });
        }

        const functionCount = service.functions?.length || Object.keys(schemaToDisplay).length;
        prompt += `**Service Schema** (${functionCount} functions):\n\n`;
        prompt += 'The following tools are available in this service with their complete argument schemas:\n\n';
        prompt += '```json\n';
        prompt += JSON.stringify(schemaToDisplay, null, 2);
        prompt += '\n```\n\n';

        // Show usage examples
        prompt += '**Usage Examples**:\n\n';
        const serviceName = service.id.replace(/-/g, '_');

        if (service.functions && service.functions.length > 0) {
          // Show examples for first 2-3 functions
          const exampleFunctions = service.functions.slice(0, Math.min(3, service.functions.length));

          exampleFunctions.forEach((func, idx) => {
            prompt += `${idx + 1}. **${func.name}**`;
            if (func.description) {
              const shortDesc = func.description.length > 80
                ? func.description.substring(0, 77) + '...'
                : func.description;
              prompt += ` - ${shortDesc}`;
            }
            prompt += '\n';

            prompt += '   ```python\n';
            prompt += `   result = await ${serviceName}.${func.name}(`;

            if (func.parameters && func.parameters.properties) {
              const params = Object.entries(func.parameters.properties);
              const paramExamples = params.slice(0, 2).map(([name, info]: [string, any]) => {
                const example = info.type === 'string' ? `"example"` :
                               info.type === 'number' ? `42` :
                               info.type === 'boolean' ? `True` :
                               info.type === 'array' ? `[]` :
                               info.type === 'object' ? `{}` : `None`;
                return `${name}=${example}`;
              });
              prompt += paramExamples.join(', ');
            }

            prompt += ')\n';
            prompt += '   print(result)\n';
            prompt += '   ```\n\n';
          });

          // Add a complete workflow example
          prompt += '**Complete Workflow Example**:\n';
          prompt += '```python\n';
          prompt += `# Step 1: Get the service\n`;
          prompt += `${serviceName} = await server.get_service("${serviceId}")\n\n`;
          prompt += `# Step 2: Use the service functions\n`;

          const firstFunc = service.functions[0];
          if (firstFunc.parameters && firstFunc.parameters.properties) {
            const params = Object.entries(firstFunc.parameters.properties);
            const paramExamples = params.slice(0, 2).map(([name, info]: [string, any]) => {
              const example = info.type === 'string' ? `"example"` :
                             info.type === 'number' ? `42` :
                             info.type === 'boolean' ? `True` : `None`;
              return `${name}=${example}`;
            });
            prompt += `result = await ${serviceName}.${firstFunc.name}(${paramExamples.join(', ')})\n`;
          } else {
            prompt += `result = await ${serviceName}.${firstFunc.name}()\n`;
          }
          prompt += 'print(result)\n';
          prompt += '```\n\n';
        }
      } else if (service.functions && service.functions.length > 0) {
        // Fallback if no schema but we have function info
        prompt += `**Available Functions** (${service.functions.length}):\n`;
        service.functions.forEach(func => {
          prompt += `- **\`${func.name}\`**`;
          if (func.description) {
            prompt += `: ${func.description}`;
          }
          prompt += '\n';
        });
        prompt += '\n';
      }

      prompt += '---\n\n';
    });

    return prompt;
  }
}
