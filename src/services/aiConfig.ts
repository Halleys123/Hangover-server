import dotenv from 'dotenv';

export type AIProviderType = 'openrouter' | 'openai' | 'ollama' | 'groq' | 'custom';

export interface AIClientConfig {
  provider: AIProviderType;
  apiKey?: string;
  baseURL?: string;
  model: string;
  isValid: boolean;
  missingVars: string[];
}

/**
 * Validates the AI provider configuration and returns the normalized parameters
 * (apiKey, baseURL, model) for OpenAI client initialization.
 * 
 * If required environment variables are missing, prints a prominent RED console error.
 */
export function validateAndGetAIConfig(logErrors = true): AIClientConfig {
  const rawProvider = (process.env.AI_PROVIDER || '').toLowerCase().trim() as AIProviderType;
  
  // Auto-detect provider if not explicitly set in .env
  let provider: AIProviderType = rawProvider;
  if (!provider) {
    if (process.env.OPENROUTER_API_KEY) provider = 'openrouter';
    else if (process.env.OPENAI_API_KEY) provider = 'openai';
    else if (process.env.GROQ_API_KEY) provider = 'groq';
    else if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) provider = 'ollama';
    else provider = 'openrouter'; // Default to openrouter
  }

  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let model: string = 'gpt-4o';
  const missingVars: string[] = [];

  switch (provider) {
    case 'openrouter': {
      apiKey = process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
      baseURL = process.env.OPENROUTER_BASE_URL || process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1';
      model = process.env.OPENROUTER_MODEL || process.env.LLM_MODEL || 'anthropic/claude-haiku-4.5';
      if (!apiKey) {
        missingVars.push('OPENROUTER_API_KEY (or LLM_API_KEY / OPENAI_API_KEY)');
      }
      break;
    }
    case 'openai': {
      apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
      baseURL = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || undefined;
      model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o';
      if (!apiKey) {
        missingVars.push('OPENAI_API_KEY');
      }
      break;
    }
    case 'ollama': {
      apiKey = process.env.OLLAMA_API_KEY || process.env.LLM_API_KEY || 'dummy-key-for-local-ollama';
      baseURL = process.env.OLLAMA_BASE_URL || process.env.LLM_BASE_URL || 'http://localhost:11434/v1';
      model = process.env.OLLAMA_MODEL || process.env.LLM_MODEL || 'llama3';
      if (!process.env.OLLAMA_MODEL && !process.env.LLM_MODEL) {
        missingVars.push('OLLAMA_MODEL (or LLM_MODEL, e.g. llama3:8b)');
      }
      break;
    }
    case 'groq': {
      apiKey = process.env.GROQ_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
      baseURL = process.env.GROQ_BASE_URL || process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
      model = process.env.GROQ_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile';
      if (!apiKey) {
        missingVars.push('GROQ_API_KEY (or LLM_API_KEY / OPENAI_API_KEY)');
      }
      break;
    }
    case 'custom': {
      apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || 'dummy-key-for-custom-endpoint';
      baseURL = process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL;
      model = process.env.LLM_MODEL || process.env.OPENAI_MODEL || 'custom-model';
      if (!baseURL) {
        missingVars.push('LLM_BASE_URL (or OPENAI_BASE_URL)');
      }
      if (!process.env.LLM_API_KEY && !process.env.OPENAI_API_KEY) {
        missingVars.push('LLM_API_KEY (or OPENAI_API_KEY)');
      }
      break;
    }
    default: {
      missingVars.push(`Unknown AI_PROVIDER '${provider}'. Valid options: openrouter, openai, ollama, groq, custom`);
      break;
    }
  }

  const isValid = missingVars.length === 0;

  if (!isValid && logErrors) {
    const red = '\x1b[31m';
    const boldRed = '\x1b[1;31m';
    const yellow = '\x1b[33m';
    const reset = '\x1b[0m';
    
    console.error(`\n${red}=================================================================${reset}`);
    console.error(`${boldRed}[AI CONFIGURATION ERROR] Missing Required Environment Variables!${reset}`);
    console.error(`${red}AI_PROVIDER is set to '${yellow}${provider}${red}', but the following required variables are missing:${reset}`);
    missingVars.forEach(v => {
      console.error(`${boldRed}  -> ${v}${reset}`);
    });
    console.error(`${red}Please check your server/.env file and add the required variables.${reset}`);
    console.error(`${red}=================================================================\n${reset}`);
  }

  return {
    provider,
    apiKey,
    baseURL,
    model,
    isValid,
    missingVars
  };
}
