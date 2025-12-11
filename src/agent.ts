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
const DEFAULT_SYSTEM_PROMPT = `You are a powerful AI coding assistant with access to a Python kernel running in the browser.`


const FORMAT_INSTRUCTIONS = `
**FUNDAMENTAL REQUIREMENT: ALWAYS EXECUTE CODE USING TOOLS**
- You must ALWAYS use the \`executeCode\` tool to run Python code - never just show code to the user
- Only provide code snippets in your text responses if the user explicitly asks to see the code
- Otherwise, directly execute code via the tool without showing it in your response
- Transform user requests into executable Python code and run it immediately
- Your primary mode of operation is executing code, not explaining theoretical concepts

**Runtime Environment**
You are running in a **Pyodide-based Jupyter notebook kernel** in the user's browser:
- **Platform**: Pyodide (Python in WebAssembly) running in browser
- **Jupyter Notebook**: Full notebook environment with persistent state between executions
- **Top-Level Await**: You can use \`await\` directly - **NO need for \`asyncio.run()\`**
  - ✅ Correct: \`result = await some_async_function()\`
  - ❌ Wrong: \`asyncio.run(some_async_function())\` (don't use this!)
- **State Persistence**: All variables, imports, and data persist between code executions
- **Automatic Display**: Matplotlib/Plotly plots display automatically - no need to save/show
- **Package Management**: Use \`import micropip; await micropip.install('package-name')\`
- **Network**: HTTP requests available through standard requests library
- **File System**: Limited file system access (browser environment)
- **Initialization**: The kernel is initialized and ready, a startup script will be executed during initialization which provides necessary tool functions etc. in the subsequent code executions.

**Multi-Step Reasoning Approach**
For complex queries, use the multi-step React loop to:
1. **Analyze**: Break down the problem into smaller steps
2. **Plan**: Outline your approach before coding
3. **Execute**: Run code step-by-step, building context gradually
4. **Observe**: Check execution results and adapt your approach
5. **Iterate**: Continue until the task is complete

Example workflow for complex tasks:
- First execution: Import libraries and explore data structure
- Second execution: Process/analyze data based on what you learned
- Third execution: Generate visualizations or final results
- Use print() statements liberally to make outputs visible

**Code Execution Guidelines**
- Write clean, well-commented Python code
- Use print() statements to output results - only printed output is visible
- Handle errors gracefully and explain what went wrong
- If code fails, analyze the error and try alternative approaches
- Available libraries: NumPy, Matplotlib, Pandas (via micropip), and Python standard library
- For visualization: matplotlib and plotly work with inline display

**Critical Principles**
- **Be Factual**: Only state information you know to be true. Don't make up facts, URLs, or capabilities
- **Verify Results**: Always check execution outputs before making claims about results
- **Admit Uncertainty**: If you're unsure about something, say so and test it with code
- **Iterate on Errors**: When code fails, analyze the error message carefully and adapt your approach
- **Build Context**: In multi-step tasks, save intermediate results to variables for reuse

**Output Requirements**
- **Execute, Don't Explain**: Run code instead of describing what code would do
- **Use print()**: Essential for making data visible across execution steps
- **Show Progress**: For long operations, print intermediate status updates
- **Summarize Results**: After execution, briefly explain what was accomplished
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

  /**
   * Get the effective system prompt (custom from settings + base prompt)
   */
  private getSystemPrompt(): string {
    if (this.settings.systemPrompt) {
      return `${this.settings.systemPrompt}\n\n---\n\n${FORMAT_INSTRUCTIONS}`;
    }
    return DEFAULT_SYSTEM_PROMPT + "\n\n" + FORMAT_INSTRUCTIONS;
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
      // Prepare messages for chat completion
      const messages = [
        { role: 'system' as const, content: this.getSystemPrompt() },
        ...this.conversationHistory
      ];

      // Debug: Log full chat messages
      console.log('[Agent] Chat completion messages:', messages);

      // Call OpenAI with streaming and function calling
      const response = await this.client.chat.completions.create({
        model: this.settings.openaiModel,
        messages: messages as any,
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
        this.onOutput("```python", 'info');
        this.onOutput(`${line}`, 'info');
      } else if (line.trim()) {
        this.onOutput(`${line}`, 'info');
      }
    });
    this.onOutput('```'); // Blank line after code

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
        } else if (evt.type === 'error' || evt.type === 'execute_error') {
          const errorMsg = `${evt.data?.ename}: ${evt.data?.evalue}`;
          outputParts.push(errorMsg);
          if (evt.data?.traceback && evt.data.traceback.length > 0) {
            // Include first few lines of traceback, strip ANSI codes
            const cleanTraceback = evt.data.traceback
              .slice(0, 5)  // Increase to 5 lines for more context
              .map((line: string) => this.stripAnsiCodes(line))
              .join('\n');
            outputParts.push(cleanTraceback);
          }
        }
      }

      const output = outputParts.join('\n').trim();

      // Debug: Log execution result details
      console.log('[Agent] Code execution result:', {
        success: result.success,
        outputParts,
        output,
        resultError: result.error
      });

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

  // Strip ANSI escape codes from text
  private stripAnsiCodes(text: string): string {
    // Remove ANSI escape sequences (colors, formatting, etc.)
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }

  // Shorten output for tool results to avoid context overflow
  private shortenOutput(text: string, _type: 'text' | 'html' | 'json'): string {
    const MAX_LENGTH = 1000; // Max characters for tool result
    const MAX_LINES = 20; // Max lines for tool result

    if (!text) return '';

    // Remove ANSI codes first
    text = this.stripAnsiCodes(text);

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

  /**
   * Process query with React loop for extended reasoning and error recovery
   * Allows multiple rounds of tool execution and reasoning
   */
  async processQueryInReactLoop(userQuery: string, maxSteps: number = 10): Promise<void> {
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

    let loopCount = 0;

    try {
      // React loop: keep calling LLM until it stops requesting tools or max steps reached
      while (loopCount < maxSteps) {
        loopCount++;

        // Prepare messages for chat completion
        const messages = [
          { role: 'system' as const, content: this.getSystemPrompt() },
          ...this.conversationHistory
        ];

        // Debug: Log full chat messages
        console.log(`[Agent] React Loop Step ${loopCount}/${maxSteps} - Chat completion messages:`, messages);

        // Call OpenAI with streaming and function calling
        const response = await this.client.chat.completions.create({
          model: this.settings.openaiModel,
          messages: messages as any,
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

        // Check if there are tool calls to execute
        if (message.tool_calls && message.tool_calls.length > 0) {
          let hasExecutedTools = false;

          // Execute tool calls
          for (const toolCall of message.tool_calls) {
            if (toolCall.type === 'function' && toolCall.function.name === 'executeCode') {
              hasExecutedTools = true;

              try {
                const args = JSON.parse(toolCall.function.arguments);
                const result = await this.executeCodeTool(args.code, args.explanation);

                // Add tool result to conversation history
                this.conversationHistory.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ success: result.success, output: result.output })
                } as any);

              } catch (error) {
                this.onOutput(`Error executing code: ${(error as Error).message}`, 'error');

                // Add error to conversation history for recovery
                this.conversationHistory.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify({ success: false, error: (error as Error).message })
                } as any);
              }
            }
          }

          // If we executed tools, continue the loop for next reasoning step
          if (hasExecutedTools) {
            // Show reasoning loop indicator after completing a step
            this.onOutput(''); // Blank line
            this.onOutput(`----Reasoning Step ${loopCount}----`, 'info');

            // Add reminder if approaching max steps
            if (loopCount >= maxSteps - 2) {
              this.conversationHistory.push({
                role: 'user',
                content: `⚠ You are approaching the maximum number of reasoning steps (${maxSteps}). Please provide a final response summarizing your work.`
              });
            }
            continue; // Continue to next iteration
          }
        }

        // No tool calls - final response received, exit loop
        this.onOutput(''); // Blank line
        this.onOutput('----------------------------------', 'info');
        break;
      }

      // Check if we hit max steps
      if (loopCount >= maxSteps) {
        this.onOutput(''); // Blank line
        this.onOutput(`⚠ Reached maximum reasoning steps (${maxSteps})`, 'info');
      }

    } catch (error) {
      const errorMsg = `Agent error: ${(error as Error).message}`;
      this.onOutput(errorMsg, 'error');
      console.error('Agent processing error:', error);
      throw error;
    }
  }
}
