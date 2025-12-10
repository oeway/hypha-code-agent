// URL Parameter Parsing and Agent Artifact Loading

export interface UrlParams {
  // Hypha connection
  server_url?: string;
  workspace?: string;
  token?: string;
  service_id?: string;
  visibility?: 'public' | 'protected';

  // Agent artifact
  agent_artifact?: string;

  // Model settings
  model?: string;
  base_url?: string;
  api_key?: string;
  temperature?: string;
  max_steps?: string;

  // OpenAI provider
  openai_provider?: string;
}

export interface AgentArtifactManifest {
  name: string;
  description: string;
  version: string;
  license: string;
  type: 'agent' | 'deno-app';
  startup_script?: string;
  welcomeMessage?: string;
  modelConfig?: {
    base_url?: string;
    model?: string;
    temperature?: number;
  };
}

export interface AgentArtifact {
  id: string;
  version: string;
  manifest: AgentArtifactManifest;
}

/**
 * Parse URL query parameters
 */
export function parseUrlParams(): UrlParams {
  const params = new URLSearchParams(window.location.search);
  const result: UrlParams = {};

  // Hypha connection parameters
  const serverUrl = params.get('server_url');
  if (serverUrl) result.server_url = serverUrl;

  const workspace = params.get('workspace');
  if (workspace) result.workspace = workspace;

  const token = params.get('token');
  if (token) result.token = token;

  const serviceId = params.get('service_id');
  if (serviceId) result.service_id = serviceId;

  const visibility = params.get('visibility');
  if (visibility === 'public' || visibility === 'protected') {
    result.visibility = visibility;
  }

  // Agent artifact
  const agentArtifact = params.get('agent_artifact');
  if (agentArtifact) result.agent_artifact = agentArtifact;

  // Model settings
  const model = params.get('model');
  if (model) result.model = model;

  const baseUrl = params.get('base_url');
  if (baseUrl) result.base_url = baseUrl;

  const apiKey = params.get('api_key');
  if (apiKey) result.api_key = apiKey;

  const temperature = params.get('temperature');
  if (temperature) result.temperature = temperature;

  const maxSteps = params.get('max_steps');
  if (maxSteps) result.max_steps = maxSteps;

  const provider = params.get('openai_provider');
  if (provider) result.openai_provider = provider;

  return result;
}

/**
 * Fetch agent artifact from Hypha server
 */
export async function fetchAgentArtifact(
  artifactId: string,
  serverUrl: string = 'https://hypha.aicell.io'
): Promise<AgentArtifact | null> {
  try {
    // Parse artifact ID - format: workspace/artifact_name or just artifact_name
    const parts = artifactId.split('/');
    const workspace = parts.length === 2 ? parts[0] : 'hypha-agents';
    const artifactName = parts.length === 2 ? parts[1] : artifactId;

    // Construct artifact URL
    const artifactUrl = `${serverUrl}/${workspace}/artifacts/${artifactName}`;

    console.log(`[URL Params] Fetching agent artifact from: ${artifactUrl}`);

    const response = await fetch(artifactUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch artifact: ${response.statusText}`);
    }

    const artifactInfo = await response.json();
    const manifest = artifactInfo.manifest;
    return {
      id: artifactId,
      version: manifest.version || '0.1.0',
      manifest
    };
  } catch (error) {
    console.error('[URL Params] Failed to fetch agent artifact:', error);
    return null;
  }
}

/**
 * Run Python startup script and capture stdout to generate system prompt
 * This matches the pattern used in hypha-agents where the stdout becomes the system prompt
 */
export async function generateSystemPromptFromScript(
  script: string,
  executeCode: (code: string) => Promise<{ success: boolean; outputs: any[] }>
): Promise<string> {
  try {
    console.log('[URL Params] Running startup script to generate system prompt...');

    const result = await executeCode(script);

    if (!result.success) {
      console.warn('[URL Params] Startup script execution failed');
      return '';
    }

    // Collect stdout from execution
    const stdoutParts: string[] = [];
    for (const output of result.outputs) {
      if (output.type === 'stream' && output.data?.name === 'stdout') {
        stdoutParts.push(output.data.text || '');
      } else if (output.type === 'execute_result' || output.type === 'display_data') {
        const text = output.data?.['text/plain'];
        if (text) stdoutParts.push(text);
      }
    }

    const systemPrompt = stdoutParts.join('').trim();
    console.log('[URL Params] Generated system prompt from script:', systemPrompt.substring(0, 100) + '...');

    return systemPrompt;
  } catch (error) {
    console.error('[URL Params] Failed to generate system prompt from script:', error);
    return '';
  }
}
