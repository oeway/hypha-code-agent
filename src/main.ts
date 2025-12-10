// Hypha Code Agent - Main Entry Point
import { settingsManager } from './settings';
import { KernelManager } from './kernel';
import { AgentManager } from './agent';
import { HyphaService } from './hypha-service';
import { TerminalRenderer, detectContentType } from './terminal-ui';
import { parseUrlParams, fetchAgentArtifact, generateSystemPromptFromScript, type AgentArtifact } from './url-params';

console.log('Hypha Code Agent initializing...');

// Parse URL parameters at startup
const urlParams = parseUrlParams();
console.log('[URL Params] Parsed URL parameters:', urlParams);

// Store agent artifact for later use
let agentArtifact: AgentArtifact | null = null;

// Kernel manager instance
let kernelManager: KernelManager | null = null;
// Agent manager instance
let agentManager: AgentManager | null = null;
// Hypha service instance
let hyphaService: HyphaService | null = null;

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

// Initialize terminal renderer
const terminalRenderer = new TerminalRenderer(terminalOutput);

// Current mode: 'script' or 'query'
let currentMode: 'script' | 'query' = 'query';

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
const maxStepsInput = document.getElementById('maxSteps') as HTMLInputElement;

// Update status
function updateStatus(status: 'ready' | 'busy' | 'error', text: string) {
  statusDot.className = 'status-dot';
  statusDot.classList.add(status);
  statusText.textContent = text;
}

// Add terminal output with enhanced rendering
function addOutput(text: string, type: string = 'info', append: boolean = false) {
  // Detect content type for better rendering
  let renderType: 'info' | 'error' | 'stderr' | 'stdout' | 'result' | 'assistant' | 'execution' | 'code' | 'markdown' = type as any;

  // Auto-detect markdown for assistant messages
  if (type === 'assistant' && !append) {
    const contentType = detectContentType(text);
    if (contentType === 'markdown') {
      renderType = 'markdown';
    } else if (contentType === 'code') {
      renderType = 'code';
    }
  }

  terminalRenderer.renderLine({
    content: text,
    type: renderType,
    timestamp: new Date()
  }, append);
}

// Clear terminal
clearBtn.addEventListener('click', () => {
  terminalRenderer.clear();
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
  maxStepsInput.value = settings.maxSteps.toString();

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
      hyphaWorkspace: hyphaWorkspaceInput.value,
      maxSteps: parseInt(maxStepsInput.value) || 10
    });

    // Update agent manager and hypha service with new settings
    if (agentManager) {
      const newSettings = settingsManager.getSettings();
      agentManager.updateSettings(newSettings);
      if (hyphaService) {
        hyphaService.updateSettings(newSettings);
      }
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

    // Initialize Hypha service
    hyphaService = new HyphaService(
      settings,
      kernelManager,
      agentManager,
      (message, type) => addOutput(message, type || 'info')
    );

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

// Handle terminal input with command history support
terminalInput.addEventListener('keydown', async (e) => {
  // Command history navigation
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const command = terminalRenderer.navigateHistory('up');
    if (command !== null) {
      terminalInput.value = command;
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const command = terminalRenderer.navigateHistory('down');
    if (command !== null) {
      terminalInput.value = command;
    }
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const input = terminalInput.value.trim();

    if (!input) return;

    // Add to command history
    terminalRenderer.addToHistory(input);
    terminalRenderer.resetHistoryIndex();

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
      addOutput(`----------------------------------\n🤔 User: \n${input}`, 'info');
      addOutput(`🤖 Assistant: `, 'assistant');

      // Use React loop by default for extended reasoning
      // Users can opt for single-step with /single prefix
      const settings = settingsManager.getSettings();
      try {
        if (input.startsWith('/single ')) {
          const actualQuery = input.substring(8).trim();
          await agentManager.processQuery(actualQuery);
        } else {
          await agentManager.processQueryInReactLoop(input, settings.maxSteps);
        }
      } catch (error) {
        addOutput(`\nAgent error: ${(error as Error).message}`, 'error');
      }
    }
  }
});

// Apply URL parameters and load agent artifact
async function applyUrlConfiguration() {
  // Load agent artifact if specified
  if (urlParams.agent_artifact) {
    addOutput(`🔍 Loading agent artifact: ${urlParams.agent_artifact}`);
    try {
      const serverUrl = urlParams.server_url || settingsManager.getSettings().hyphaServerUrl;
      agentArtifact = await fetchAgentArtifact(urlParams.agent_artifact, serverUrl);

      if (agentArtifact) {
        addOutput(`✓ Loaded agent artifact: ${agentArtifact.manifest.name} v${agentArtifact.manifest.version}`);
      } else {
        addOutput(`⚠ Failed to load agent artifact: ${urlParams.agent_artifact}`, 'error');
      }
    } catch (error) {
      addOutput(`⚠ Error loading agent artifact: ${(error as Error).message}`, 'error');
    }
  }

  // Apply URL parameters to settings
  const currentSettings = settingsManager.getSettings();
  const updatedSettings = { ...currentSettings };
  let hasChanges = false;

  // Priority: URL params > existing settings (agent artifact only affects startup script and system prompt)

  // Model configuration from URL params only
  if (urlParams.base_url) {
    updatedSettings.openaiBaseUrl = urlParams.base_url;
    hasChanges = true;
  }
  if (urlParams.model) {
    updatedSettings.openaiModel = urlParams.model;
    hasChanges = true;
  }
  if (urlParams.api_key) {
    updatedSettings.openaiApiKey = urlParams.api_key;
    hasChanges = true;
  }
  if (urlParams.openai_provider) {
    updatedSettings.openaiProvider = urlParams.openai_provider as 'openai' | 'ollama' | 'custom';
    hasChanges = true;
  }

  // Hypha connection settings from URL params
  if (urlParams.server_url) {
    updatedSettings.hyphaServerUrl = urlParams.server_url;
    hasChanges = true;
  }
  if (urlParams.workspace) {
    updatedSettings.hyphaWorkspace = urlParams.workspace;
    hasChanges = true;
  }

  // Max steps
  if (urlParams.max_steps) {
    updatedSettings.maxSteps = parseInt(urlParams.max_steps) || 10;
    hasChanges = true;
  }

  // Save updated settings
  if (hasChanges) {
    settingsManager.saveSettings(updatedSettings);
    addOutput('✓ Settings updated from URL parameters and/or agent artifact');

    // Update agent manager with new settings
    if (agentManager) {
      agentManager.updateSettings(settingsManager.getSettings());
    }
    if (hyphaService) {
      hyphaService.updateSettings(settingsManager.getSettings());
    }
  }

  // Run startup script from agent artifact if present
  if (agentArtifact?.manifest.startup_script && kernelManager) {
    addOutput('🐍 Running agent startup script...');
    try {
      const systemPrompt = await generateSystemPromptFromScript(
        agentArtifact.manifest.startup_script,
        (code) => kernelManager!.executeCode(code)
      );

      if (systemPrompt) {
        addOutput(`✓ System prompt generated (${systemPrompt.length} chars)`);
        // Save startup script and system prompt to settings
        settingsManager.saveSettings({
          startupScript: agentArtifact.manifest.startup_script,
          systemPrompt: systemPrompt
        });
        addOutput('✓ System prompt saved to settings');

        // Update agent manager with new system prompt
        if (agentManager) {
          agentManager.updateSettings(settingsManager.getSettings());
          addOutput('✓ Agent manager updated with system prompt');
        }
        if (hyphaService) {
          hyphaService.updateSettings(settingsManager.getSettings());
        }
      }
    } catch (error) {
      addOutput(`⚠ Failed to run startup script: ${(error as Error).message}`, 'error');
    }
  }

  // Show welcome message from agent artifact if present
  if (agentArtifact?.manifest.welcomeMessage) {
    addOutput('');
    addOutput(agentArtifact.manifest.welcomeMessage, 'assistant');
    addOutput('');
  }
}

// Initialize
addOutput('✓ UI loaded successfully');
const settings = settingsManager.getSettings();
addOutput(`✓ Settings loaded (Provider: ${settings.openaiProvider}, Model: ${settings.openaiModel})`);
updateStatus('ready', 'Ready');

console.log('✓ Hypha Code Agent UI initialized');

// Connect to Hypha button handler
connectBtn.addEventListener('click', async () => {
  if (!hyphaService) {
    addOutput('⚠ Hypha service not initialized', 'error');
    return;
  }

  if (hyphaService.isConnected()) {
    const info = hyphaService.getServiceInfo();
    addOutput('Already connected to Hypha', 'info');
    if (info.serviceId && info.serviceUrl) {
      addOutput(`Service ID: ${info.serviceId}`, 'info');
      addOutput(`Service URL: ${info.serviceUrl}`, 'info');
    }
    return;
  }

  connectBtn.disabled = true;
  try {
    const settings = settingsManager.getSettings();
    await hyphaService.connect({
      serverUrl: settings.hyphaServerUrl,
      workspace: settings.hyphaWorkspace,
      serviceId: urlParams.service_id || 'hypha-code-agent',
      visibility: urlParams.visibility || 'protected',
      token: urlParams.token
    });
    connectBtn.textContent = 'Connected ✓';
  } catch (error) {
    addOutput(`Failed to connect to Hypha: ${(error as Error).message}`, 'error');
    connectBtn.disabled = false;
  }
});

// Auto-initialize kernel and apply configuration
(async () => {
  await initializeKernel();

  // Apply URL configuration after kernel is ready
  if (Object.keys(urlParams).length > 0 || urlParams.agent_artifact) {
    await applyUrlConfiguration();
  }

  // Auto-connect to Hypha if token is provided in URL
  if (urlParams.token && hyphaService) {
    addOutput('🔗 Auto-connecting to Hypha with URL token...');
    connectBtn.click();
  }
})();
