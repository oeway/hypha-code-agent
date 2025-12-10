// Web Python Kernel Manager
import type { KernelManager as KM, KernelMode as KMMode, KernelLanguage as KLang } from 'web-python-kernel';

export interface ExecutionEvent {
  type: 'stream' | 'execute_result' | 'display_data' | 'error' | 'execute_error';
  data?: any;
}

export interface ExecutionResult {
  success: boolean;
  outputs: ExecutionEvent[];
  error?: string;
}

// Startup script that runs when kernel is initialized
const STARTUP_SCRIPT = `
# Hypha Code Agent - Kernel Startup Script
import sys
print("🐍 Python kernel initialized")
print(f"Python version: {sys.version}")

# Import common libraries
try:
    import numpy as np
    print("✓ NumPy loaded")
except ImportError:
    print("⚠ NumPy not available")

try:
    import matplotlib
    matplotlib.use('module://matplotlib_inline.backend_inline')
    import matplotlib.pyplot as plt
    print("✓ Matplotlib loaded (inline mode)")
except ImportError:
    print("⚠ Matplotlib not available")

print("✓ Kernel ready for code execution")
`;

export class KernelManager {
  private kernelManager: KM | null = null;
  private kernelId: string | null = null;
  private KernelManagerClass: any = null;
  private KernelMode: any = null;
  private KernelLanguage: any = null;
  private KernelEvents: any = null;
  private onOutput: (message: string, type?: string) => void;
  private onStatusChange: (status: 'initializing' | 'ready' | 'busy' | 'error', message: string) => void;

  constructor(
    onOutput: (message: string, type?: string) => void,
    onStatusChange: (status: 'initializing' | 'ready' | 'busy' | 'error', message: string) => void
  ) {
    this.onOutput = onOutput;
    this.onStatusChange = onStatusChange;
  }

  async initialize(): Promise<void> {
    try {
      this.onStatusChange('initializing', 'Loading kernel module...');
      this.onOutput('Loading web-python-kernel module...');

      // Dynamically import the kernel module
      const module = await import('web-python-kernel');
      this.KernelManagerClass = module.KernelManager;
      this.KernelMode = module.KernelMode;
      this.KernelLanguage = module.KernelLanguage;
      this.KernelEvents = module.KernelEvents;

      this.onOutput('✓ Kernel module loaded');
      this.onStatusChange('initializing', 'Creating kernel manager...');

      // Create kernel manager
      this.kernelManager = new this.KernelManagerClass({
        allowedKernelTypes: [
          {
            mode: this.KernelMode.WORKER,
            language: this.KernelLanguage.PYTHON
          }
        ],
        interruptionMode: 'auto',
        pool: {
          enabled: false,
          poolSize: 0,
          autoRefill: false
        },
        workerUrl: '/kernel.worker.js'  // Specify worker URL relative to public folder (note: lowercase 'u')
      });

      this.onOutput('✓ Kernel manager created');
      this.onStatusChange('initializing', 'Initializing Python kernel...');

      // Create kernel instance
      this.kernelId = await this.kernelManager.createKernel({
        mode: this.KernelMode.WORKER,
        lang: this.KernelLanguage.PYTHON,
        autoSyncFs: false
      });

      this.onOutput(`✓ Kernel created: ${this.kernelId.substring(0, 8)}...`);

      // Set up event listeners
      this.setupEventListeners();

      // Run startup script
      this.onStatusChange('initializing', 'Running startup script...');
      this.onOutput('Running kernel startup script...');

      await this.executeStartupScript();

      this.onStatusChange('ready', 'Kernel ready');
      this.onOutput('✓ Kernel initialization complete');
    } catch (error) {
      const errorMsg = `Failed to initialize kernel: ${(error as Error).message}`;
      this.onStatusChange('error', errorMsg);
      this.onOutput(`✗ ${errorMsg}`);
      console.error('Kernel initialization error:', error);
      throw error;
    }
  }

  private setupEventListeners(): void {
    if (!this.kernelManager || !this.kernelId) return;

    this.kernelManager.onKernelEvent(this.kernelId, this.KernelEvents.KERNEL_BUSY, () => {
      this.onStatusChange('busy', 'Kernel busy...');
    });

    this.kernelManager.onKernelEvent(this.kernelId, this.KernelEvents.KERNEL_IDLE, () => {
      this.onStatusChange('ready', 'Kernel ready');
    });
  }

  private async executeStartupScript(): Promise<void> {
    if (!this.kernelManager || !this.kernelId) {
      throw new Error('Kernel not initialized');
    }

    try {
      const stream = this.kernelManager.executeStream(this.kernelId, STARTUP_SCRIPT);

      for await (const event of stream) {
        if (event.type === 'stream' && event.data?.name === 'stdout') {
          // Split by newlines and output each line separately (removes empty lines)
          const lines = event.data.text.split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => this.onOutput(line));
        } else if (event.type === 'error' || event.type === 'execute_error') {
          throw new Error(`Startup script error: ${event.data?.evalue || 'Unknown error'}`);
        }
      }
    } catch (error) {
      throw new Error(`Startup script execution failed: ${(error as Error).message}`);
    }
  }

  async executeCode(code: string): Promise<ExecutionResult> {
    if (!this.kernelManager || !this.kernelId) {
      throw new Error('Kernel not initialized');
    }

    const outputs: ExecutionEvent[] = [];
    let hasError = false;

    try {
      const stream = this.kernelManager.executeStream(this.kernelId, code);

      for await (const event of stream) {
        outputs.push(event);

        // Output results to terminal
        if (event.type === 'stream') {
          if (event.data?.name === 'stdout') {
            // Split by newlines and output non-empty lines
            const lines = event.data.text.split('\n').filter((line: string) => line.trim());
            lines.forEach((line: string) => this.onOutput(line, 'stdout'));
          } else if (event.data?.name === 'stderr') {
            const lines = event.data.text.split('\n').filter((line: string) => line.trim());
            lines.forEach((line: string) => this.onOutput(line, 'stderr'));
          }
        } else if (event.type === 'execute_result') {
          if (event.data?.data?.['text/plain']) {
            const result = event.data.data['text/plain'].trim();
            if (result) this.onOutput(result, 'result');
          }
        } else if (event.type === 'display_data') {
          if (event.data?.data?.['image/png']) {
            this.onOutput('[Image output - PNG]', 'result');
            // Could render image here if needed
          } else if (event.data?.data?.['text/plain']) {
            const result = event.data.data['text/plain'].trim();
            if (result) this.onOutput(result, 'result');
          }
        } else if (event.type === 'error' || event.type === 'execute_error') {
          hasError = true;
          const errorMsg = `${event.data?.ename || 'Error'}: ${event.data?.evalue || 'Unknown error'}`;
          this.onOutput(errorMsg, 'error');

          if (event.data?.traceback) {
            event.data.traceback.forEach((line: string) => {
              if (line.trim()) this.onOutput(line, 'error');
            });
          }
        }
      }

      return {
        success: !hasError,
        outputs
      };
    } catch (error) {
      this.onOutput(`Execution error: ${(error as Error).message}`, 'error');
      return {
        success: false,
        outputs,
        error: (error as Error).message
      };
    }
  }

  async restartKernel(): Promise<void> {
    if (!this.kernelManager || !this.kernelId) {
      throw new Error('Kernel not initialized');
    }

    this.onStatusChange('initializing', 'Restarting kernel...');
    this.onOutput('Restarting kernel...');

    try {
      // Destroy current kernel
      await this.kernelManager.destroyKernel(this.kernelId);
      this.onOutput('✓ Old kernel destroyed');

      // Create new kernel
      this.kernelId = await this.kernelManager.createKernel({
        mode: this.KernelMode.WORKER,
        lang: this.KernelLanguage.PYTHON,
        autoSyncFs: false
      });

      this.onOutput(`✓ New kernel created: ${this.kernelId.substring(0, 8)}...`);

      // Re-setup event listeners
      this.setupEventListeners();

      // Run startup script
      await this.executeStartupScript();

      this.onStatusChange('ready', 'Kernel ready');
      this.onOutput('✓ Kernel restarted successfully');
    } catch (error) {
      const errorMsg = `Failed to restart kernel: ${(error as Error).message}`;
      this.onStatusChange('error', errorMsg);
      this.onOutput(`✗ ${errorMsg}`);
      throw error;
    }
  }

  async interruptKernel(): Promise<void> {
    if (!this.kernelManager || !this.kernelId) {
      throw new Error('Kernel not initialized');
    }

    try {
      const success = await this.kernelManager.interruptKernel(this.kernelId);
      if (success) {
        this.onOutput('✓ Kernel interrupted');
      } else {
        this.onOutput('✗ Failed to interrupt kernel');
      }
    } catch (error) {
      this.onOutput(`✗ Interrupt error: ${(error as Error).message}`);
      throw error;
    }
  }

  getKernelId(): string | null {
    return this.kernelId;
  }

  isInitialized(): boolean {
    return this.kernelManager !== null && this.kernelId !== null;
  }
}
