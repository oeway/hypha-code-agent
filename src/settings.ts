// Settings Management with LocalStorage

export interface AgentSettings {
  // OpenAI Configuration
  openaiProvider: 'openai' | 'ollama' | 'custom';
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey: string;

  // Hypha Configuration
  hyphaServerUrl: string;
  hyphaWorkspace: string;

  // Agent Behavior
  maxSteps: number; // Maximum reasoning steps for React loop

  // Custom System Prompt
  startupScript?: string; // Python script to generate system prompt from stdout
  systemPrompt?: string; // Generated or manually set system prompt
}

const DEFAULT_SETTINGS: AgentSettings = {
  openaiProvider: 'ollama',
  openaiBaseUrl: 'http://localhost:11434/v1/',
  openaiModel: 'qwen2.5-coder:7b',
  openaiApiKey: 'ollama',
  hyphaServerUrl: 'https://hypha.aicell.io',
  hyphaWorkspace: '',
  maxSteps: 25
};

const STORAGE_KEY = 'hypha-code-agent-settings';

export class SettingsManager {
  private settings: AgentSettings;

  constructor() {
    this.settings = this.loadSettings();
  }

  private loadSettings(): AgentSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings(settings: Partial<AgentSettings>): void {
    this.settings = { ...this.settings, ...settings };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      console.log('Settings saved successfully');
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw new Error('Failed to save settings to localStorage');
    }
  }

  getSettings(): AgentSettings {
    return { ...this.settings };
  }

  getSetting<K extends keyof AgentSettings>(key: K): AgentSettings[K] {
    return this.settings[key];
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log('Settings reset to defaults');
    } catch (error) {
      console.error('Failed to reset settings:', error);
    }
  }

  // Helper to get provider-specific defaults
  getProviderDefaults(provider: string): Partial<AgentSettings> {
    switch (provider) {
      case 'openai':
        return {
          openaiBaseUrl: 'https://api.openai.com/v1/',
          openaiModel: 'gpt-4',
          openaiApiKey: ''
        };
      case 'ollama':
        return {
          openaiBaseUrl: 'http://localhost:11434/v1/',
          openaiModel: 'qwen2.5-coder:7b',
          openaiApiKey: 'ollama'
        };
      case 'custom':
        return {
          openaiBaseUrl: '',
          openaiModel: '',
          openaiApiKey: ''
        };
      default:
        return {};
    }
  }
}

// Export singleton instance
export const settingsManager = new SettingsManager();
