// Hypha Code Agent - Main Entry Point
import { settingsManager } from './settings';
import { KernelManager } from './kernel';
import { AgentManager } from './agent';

console.log('Hypha Code Agent initializing...');

// Kernel manager instance
let kernelManager: KernelManager | null = null;
// Agent manager instance
let agentManager: AgentManager | null = null;

// Get DOM elements
const statusDot = document.getElementById('statusDot') as HTMLElement;
const statusText = document.getElementById('statusText') as HTMLElement;
const terminalOutput = document.getElementById('terminalOutput') as HTMLElement;
const terminalInput = document.getElementById('terminalInput') as HTMLInputElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const restartBtn = document.getElementById('restartBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;
const scriptModeBtn = document.getElementById('scriptModeBtn') as HTMLButtonElement;
const queryModeBtn = document.getElementById('queryModeBtn') as HTMLButtonElement;

// Current mode: 'script' or 'query'
let currentMode: 'script' | 'query' = 'script';

// Settings modal elements
const settingsModal = document.getElementById('settingsModal') as HTMLElement;
const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement;
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
const openaiProviderSelect = document.getElementById('openaiProvider') as HTMLSelectElement;
const openaiBaseUrlInput = document.getElementById('openaiBaseUrl') as HTMLInputElement;
const openaiModelInput = document.getElementById('openaiModel') as HTMLInputElement;
const openaiApiKeyInput = document.getElementById('openaiApiKey') as HTMLInputElement;
const hyphaServerUrlInput = document.getElementById('hyphaServerUrl') as HTMLInputElement;
const hyphaWorkspaceInput = document.getElementById('hyphaWorkspace') as HTMLInputElement;

// Update status
function updateStatus(status: 'ready' | 'busy' | 'error', text: string) {
  statusDot.className = 'status-dot';
  statusDot.classList.add(status);
  statusText.textContent = text;
}

// Track the last output line for streaming
let lastOutputLine: HTMLElement | null = null;

// Add terminal output
function addOutput(text: string, type: string = 'info', append: boolean = false) {
  if (append && lastOutputLine) {
    // Append to existing line for streaming
    lastOutputLine.textContent += text;
  } else {
    // Create new line
    const line = document.createElement('div');
    line.className = 'terminal-line';

    // Add styling based on type
    if (type === 'error' || type === 'stderr') {
      line.style.color = '#f48771';
    } else if (type === 'result') {
      line.style.color = '#4ec9b0';
    } else if (type === 'stdout') {
      line.style.color = '#d4d4d4';
    } else if (type === 'assistant') {
      line.style.color = '#9cdcfe'; // Light blue for assistant
    } else if (type === 'execution') {
      line.style.color = '#ce9178'; // Orange for code execution
    }

    line.textContent = text;
    terminalOutput.appendChild(line);
    lastOutputLine = line;
  }

  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// Clear terminal
clearBtn.addEventListener('click', () => {
  terminalOutput.innerHTML = '';
  addOutput('Terminal cleared.');
});

// Settings Dialog Management
function showSettingsDialog() {
  const settings = settingsManager.getSettings();

  // Load current settings into form
  openaiProviderSelect.value = settings.openaiProvider;
  openaiBaseUrlInput.value = settings.openaiBaseUrl;
  openaiModelInput.value = settings.openaiModel;
  openaiApiKeyInput.value = settings.openaiApiKey;
  hyphaServerUrlInput.value = settings.hyphaServerUrl;
  hyphaWorkspaceInput.value = settings.hyphaWorkspace;

  settingsModal.classList.add('show');
}

function hideSettingsDialog() {
  settingsModal.classList.remove('show');
}

function saveSettings() {
  try {
    settingsManager.saveSettings({
      openaiProvider: openaiProviderSelect.value as 'openai' | 'ollama' | 'custom',
      openaiBaseUrl: openaiBaseUrlInput.value,
      openaiModel: openaiModelInput.value,
      openaiApiKey: openaiApiKeyInput.value,
      hyphaServerUrl: hyphaServerUrlInput.value,
      hyphaWorkspace: hyphaWorkspaceInput.value
    });

    // Update agent manager with new settings
    if (agentManager) {
      const newSettings = settingsManager.getSettings();
      agentManager.updateSettings(newSettings);
      addOutput('✓ Settings saved and agent updated');
    } else {
      addOutput('✓ Settings saved successfully');
    }

    hideSettingsDialog();
  } catch (error) {
    addOutput('✗ Failed to save settings: ' + (error as Error).message);
    console.error('Save settings error:', error);
  }
}

// Settings button click
settingsBtn.addEventListener('click', showSettingsDialog);

// Close settings dialog
closeSettingsBtn.addEventListener('click', hideSettingsDialog);
cancelSettingsBtn.addEventListener('click', hideSettingsDialog);

// Save settings
saveSettingsBtn.addEventListener('click', saveSettings);

// Provider change - update defaults
openaiProviderSelect.addEventListener('change', (e) => {
  const provider = (e.target as HTMLSelectElement).value;
  const defaults = settingsManager.getProviderDefaults(provider);

  if (defaults.openaiBaseUrl) openaiBaseUrlInput.value = defaults.openaiBaseUrl;
  if (defaults.openaiModel) openaiModelInput.value = defaults.openaiModel;
  if (defaults.openaiApiKey !== undefined) openaiApiKeyInput.value = defaults.openaiApiKey;
});

// Close modal on overlay click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) {
    hideSettingsDialog();
  }
});

// Kernel initialization
async function initializeKernel() {
  try {
    kernelManager = new KernelManager(
      (message, type) => addOutput(message, type || 'info'),
      (status, message) => updateStatus(status as any, message)
    );

    await kernelManager.initialize();

    // Initialize agent manager after kernel is ready
    const settings = settingsManager.getSettings();
    agentManager = new AgentManager(
      settings,
      kernelManager,
      (message, type, append) => addOutput(message, type || 'info', append || false)
    );
    addOutput('✓ AI agent initialized');

    restartBtn.disabled = false;
    terminalInput.disabled = false;
  } catch (error) {
    addOutput(`Failed to initialize kernel: ${(error as Error).message}`, 'error');
    updateStatus('error', 'Kernel initialization failed');
  }
}

// Restart kernel
restartBtn.addEventListener('click', async () => {
  if (!kernelManager) return;

  restartBtn.disabled = true;
  try {
    await kernelManager.restartKernel();
    restartBtn.disabled = false;
  } catch (error) {
    addOutput(`Failed to restart kernel: ${(error as Error).message}`, 'error');
    restartBtn.disabled = false;
  }
});

// Mode switching
function setMode(mode: 'script' | 'query') {
  currentMode = mode;

  // Update button states
  if (mode === 'script') {
    scriptModeBtn.classList.add('active');
    queryModeBtn.classList.remove('active');
    terminalInput.placeholder = 'Type Python code here (Press Enter to execute)...';
  } else {
    scriptModeBtn.classList.remove('active');
    queryModeBtn.classList.add('active');
    terminalInput.placeholder = 'Ask AI to write and execute code (Press Enter to send)...';
  }
}

scriptModeBtn.addEventListener('click', () => setMode('script'));
queryModeBtn.addEventListener('click', () => setMode('query'));

// Handle terminal input
terminalInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const input = terminalInput.value.trim();

    if (!input) return;

    // Clear input
    terminalInput.value = '';

    if (currentMode === 'script') {
      // Script mode: Execute Python code directly
      if (!kernelManager || !kernelManager.isInitialized()) {
        addOutput('Kernel not initialized', 'error');
        return;
      }

      // Show input
      addOutput(`>>> ${input}`, 'info');

      // Execute code
      try {
        await kernelManager.executeCode(input);
      } catch (error) {
        addOutput(`Execution error: ${(error as Error).message}`, 'error');
      }
    } else {
      // Query mode: Send to AI agent
      if (!agentManager) {
        addOutput('⚠ AI agent not initialized', 'error');
        return;
      }

      if (!kernelManager || !kernelManager.isInitialized()) {
        addOutput('Kernel not initialized', 'error');
        return;
      }

      // Show user query with spacing
      addOutput(''); // Blank line before
      addOutput(`🤔 User: ${input}`, 'info');
      addOutput(`🤖 Assistant: `, 'assistant');

      // Process query with agent
      try {
        await agentManager.processQuery(input);
      } catch (error) {
        addOutput(`\nAgent error: ${(error as Error).message}`, 'error');
      }
    }
  }
});

// Initialize
addOutput('✓ UI loaded successfully');
const settings = settingsManager.getSettings();
addOutput(`✓ Settings loaded (Provider: ${settings.openaiProvider}, Model: ${settings.openaiModel})`);
updateStatus('ready', 'Ready');

console.log('✓ Hypha Code Agent UI initialized');

// Auto-initialize kernel
initializeKernel();
