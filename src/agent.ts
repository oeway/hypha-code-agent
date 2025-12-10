// OpenAI Agent Manager for Code Execution
import OpenAI from 'openai';
import type { AgentSettings } from './settings';
import type { KernelManager, ExecutionResult } from './kernel';

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentResponse {
  type: 'message' | 'code_execution' | 'error';
  content: string;
  code?: string;
  executionResult?: ExecutionResult;
}

// System prompt for the code agent
const SYSTEM_PROMPT = `You are a helpful AI coding assistant with access to a Python kernel running in the browser.

You can execute Python code to help users with their tasks. When you need to run Python code, you must initialize a tool call to the \`executeCode\` function.

Guidelines:
- Write clean, well-documented Python code
- Explain what the code does before executing it
- Handle errors gracefully and explain what went wrong
- Use the Python kernel's available libraries (NumPy, Matplotlib, etc.)
- For data visualization, use matplotlib with inline backend
- Keep code concise and focused on the task

The Python kernel is initialized and ready. You can execute code immediately.
It's a pyodide based python jupyter kernel, so be aware of the limitations in the web environment.
`;

export class AgentManager {
  private client: OpenAI | null = null;
  private settings: AgentSettings;
  private kernelManager: KernelManager;
  private conversationHistory: AgentMessage[] = [];
  private onOutput: (message: string, type?: string, append?: boolean) => void;

  constructor(
    settings: AgentSettings,
    kernelManager: KernelManager,
    onOutput: (message: string, type?: string, append?: boolean) => void
  ) {
    this.settings = settings;
    this.kernelManager = kernelManager;
    this.onOutput = onOutput;
    this.initializeClient();
  }

  private initializeClient(): void {
    try {
      this.client = new OpenAI({
        baseURL: this.settings.openaiBaseUrl,
        apiKey: this.settings.openaiApiKey,
        dangerouslyAllowBrowser: true // Required for browser usage
      });
      console.log('✓ OpenAI client initialized');
    } catch (error) {
      console.error('Failed to initialize OpenAI client:', error);
      throw error;
    }
  }

  updateSettings(settings: AgentSettings): void {
    this.settings = settings;
    this.initializeClient();
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  async processQuery(userQuery: string): Promise<void> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized');
    }

    if (!this.kernelManager.isInitialized()) {
      throw new Error('Kernel not initialized');
    }

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userQuery
    });

    try {
      // Call OpenAI with streaming and function calling
      const response = await this.client.chat.completions.create({
        model: this.settings.openaiModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...this.conversationHistory
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'executeCode',
              description: 'Execute Python code in the browser-based Python kernel. Use this to run Python code, perform calculations, create visualizations, or process data.',
              parameters: {
                type: 'object',
                properties: {
                  code: {
                    type: 'string',
                    description: 'The Python code to execute. Can be multiple lines.'
                  },
                  explanation: {
                    type: 'string',
                    description: 'A brief explanation of what this code does and why you are running it.'
                  }
                },
                required: ['code', 'explanation']
              }
            }
          }
        ],
        stream: true,
        temperature: 0.7
      });

      // Use messageReducer pattern from OpenAI example
      let message: any = { role: 'assistant', content: '' };
      let isFirstChunk = true;

      // Process streaming response and accumulate complete message
      for await (const chunk of response) {
        message = this.messageReducer(message, chunk);

        // Stream content to output
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          this.onOutput(delta.content, 'assistant', !isFirstChunk);
          isFirstChunk = false;
        }
      }

      // Add assistant message to history
      this.conversationHistory.push({
        role: 'assistant',
        content: message.content || '',
        ...(message.tool_calls && { tool_calls: message.tool_calls })
      } as any);

      // Execute tool calls if any
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          if (toolCall.type === 'function' && toolCall.function.name === 'executeCode') {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              const result = await this.executeCodeTool(args.code, args.explanation);

              // Add tool result to conversation history as per OpenAI pattern
              this.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ success: result.success, output: result.output })
              } as any);
            } catch (error) {
              this.onOutput(`Error executing code: ${(error as Error).message}`, 'error');

              // Add error to conversation history
              this.conversationHistory.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ success: false, error: (error as Error).message })
              } as any);
            }
          }
        }
      }

    } catch (error) {
      const errorMsg = `Agent error: ${(error as Error).message}`;
      this.onOutput(errorMsg, 'error');
      console.error('Agent processing error:', error);
      throw error;
    }
  }

  // Message reducer to accumulate streaming chunks (from OpenAI example)
  private messageReducer(previous: any, chunk: any): any {
    const reduce = (acc: any, delta: any): any => {
      acc = { ...acc };
      for (const [key, value] of Object.entries(delta)) {
        if (acc[key] === undefined || acc[key] === null) {
          acc[key] = value;
          // Remove index from tool_calls array items
          if (Array.isArray(acc[key])) {
            for (const arr of acc[key]) {
              delete arr.index;
            }
          }
        } else if (typeof acc[key] === 'string' && typeof value === 'string') {
          acc[key] += value;
        } else if (typeof acc[key] === 'number' && typeof value === 'number') {
          acc[key] = value;
        } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
          const accArray = acc[key];
          for (let i = 0; i < value.length; i++) {
            const { index, ...chunkTool } = value[i];
            accArray[index] = reduce(accArray[index] || {}, chunkTool);
          }
        } else if (typeof acc[key] === 'object' && typeof value === 'object') {
          acc[key] = reduce(acc[key], value);
        }
      }
      return acc;
    };

    const choice = chunk.choices[0];
    if (!choice) {
      return previous;
    }
    return reduce(previous, choice.delta);
  }

  private async executeCodeTool(code: string, explanation: string): Promise<{ success: boolean; output: string }> {
    // Output explanation with proper spacing
    this.onOutput(''); // Blank line
    this.onOutput(`💡 ${explanation}`, 'info');
    this.onOutput(''); // Blank line
    this.onOutput(`🔧 Tool (executeCode):`, 'execution');

    // Format code block
    const codeLines = code.split('\n');
    codeLines.forEach((line, index) => {
      if (index === 0) {
        this.onOutput(`>>> ${line}`, 'info');
      } else if (line.trim()) {
        this.onOutput(`... ${line}`, 'info');
      }
    });
    this.onOutput(''); // Blank line after code

    try {
      // Execute code using kernel
      const result = await this.kernelManager.executeCode(code);

      // Collect and shorten output for tool result
      const outputParts: string[] = [];

      for (const evt of result.outputs) {
        if (evt.type === 'stream') {
          const text = evt.data?.text || '';
          outputParts.push(this.shortenOutput(text, 'text'));
        } else if (evt.type === 'execute_result' || evt.type === 'display_data') {
          const data = evt.data?.data;
          if (data) {
            // Handle different MIME types
            if (data['image/png']) {
              outputParts.push('<image/png: base64 data truncated>');
            } else if (data['image/jpeg']) {
              outputParts.push('<image/jpeg: base64 data truncated>');
            } else if (data['text/html']) {
              outputParts.push(this.shortenOutput(data['text/html'], 'html'));
            } else if (data['application/json']) {
              outputParts.push(this.shortenOutput(JSON.stringify(data['application/json']), 'json'));
            } else if (data['text/plain']) {
              outputParts.push(this.shortenOutput(data['text/plain'], 'text'));
            }
          }
        } else if (evt.type === 'error') {
          const errorMsg = `${evt.data?.ename}: ${evt.data?.evalue}`;
          outputParts.push(errorMsg);
          if (evt.data?.traceback && evt.data.traceback.length > 0) {
            // Include first few lines of traceback
            outputParts.push(evt.data.traceback.slice(0, 3).join('\n'));
          }
        }
      }

      const output = outputParts.join('\n').trim();

      return {
        success: result.success,
        output: output || (result.success ? 'Code executed successfully (no output)' : result.error || 'Unknown error')
      };

    } catch (error) {
      const errorMsg = `Execution error: ${(error as Error).message}`;
      this.onOutput(errorMsg, 'error');

      return {
        success: false,
        output: errorMsg
      };
    }
  }

  // Shorten output for tool results to avoid context overflow
  private shortenOutput(text: string, type: 'text' | 'html' | 'json'): string {
    const MAX_LENGTH = 1000; // Max characters for tool result
    const MAX_LINES = 20; // Max lines for tool result

    if (!text) return '';

    // Remove excessive whitespace
    text = text.trim();

    // Limit by lines first
    const lines = text.split('\n');
    if (lines.length > MAX_LINES) {
      const truncatedLines = lines.slice(0, MAX_LINES);
      text = truncatedLines.join('\n') + `\n... (${lines.length - MAX_LINES} more lines truncated)`;
    }

    // Then limit by character count
    if (text.length > MAX_LENGTH) {
      text = text.substring(0, MAX_LENGTH) + `\n... (${text.length - MAX_LENGTH} more characters truncated)`;
    }

    return text;
  }

  getConversationHistory(): AgentMessage[] {
    return [...this.conversationHistory];
  }
}
