import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export type AIProviderType = 'openrouter' | 'nvidia' | 'openai' | 'ollama' | 'groq' | 'custom';

export interface AIClientConfig {
  provider: AIProviderType;
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
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
  const provider = env.AI_PROVIDER as AIProviderType;
  
  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let defaultHeaders: Record<string, string> | undefined;
  let model: string = 'gpt-4o';
  const missingVars: string[] = [];

  switch (provider) {
    case 'openrouter': {
      apiKey = env.OPENROUTER_API_KEY;
      baseURL = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
      model = env.OPENROUTER_MODEL || 'openrouter/free';
      defaultHeaders = {};
      if (process.env.OPENROUTER_SITE_URL) {
        defaultHeaders['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
      }
      if (process.env.OPENROUTER_APP_NAME) {
        defaultHeaders['X-OpenRouter-Title'] = process.env.OPENROUTER_APP_NAME;
      }
      if (!apiKey) {
        missingVars.push('OPENROUTER_API_KEY (or LLM_API_KEY / OPENAI_API_KEY)');
      }
      break;
    }
    case 'nvidia': {
      apiKey = env.NVIDIA_API_KEY;
      baseURL = env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
      model = env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';
      if (!apiKey) {
        missingVars.push('NVIDIA_API_KEY (or NIM_API_KEY / LLM_API_KEY)');
      }
      break;
    }
    case 'openai': {
      apiKey = env.OPENAI_API_KEY;
      baseURL = env.OPENAI_BASE_URL || undefined;
      model = env.OPENAI_MODEL || 'gpt-4o';
      if (!apiKey) {
        missingVars.push('OPENAI_API_KEY');
      }
      break;
    }
    case 'ollama': {
      apiKey = env.OLLAMA_API_KEY || 'dummy-key-for-local-ollama';
      baseURL = env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
      model = env.OLLAMA_MODEL || 'llama3.1:latest';
      if (model === 'llama3' || model === 'llama3:8b') {
        model = 'llama3.1:latest';
      }
      break;
    }
    case 'groq': {
      apiKey = env.GROQ_API_KEY;
      baseURL = env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
      model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
      if (!apiKey) {
        missingVars.push('GROQ_API_KEY (or LLM_API_KEY / OPENAI_API_KEY)');
      }
      break;
    }
    case 'custom': {
      apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || 'dummy-key-for-custom-endpoint';
      baseURL = env.LLM_BASE_URL || env.OPENAI_BASE_URL;
      model = env.LLM_MODEL || env.OPENAI_MODEL || 'custom-model';
      if (!baseURL) {
        missingVars.push('LLM_BASE_URL (or OPENAI_BASE_URL)');
      }
      if (!env.LLM_API_KEY && !env.OPENAI_API_KEY) {
        missingVars.push('LLM_API_KEY (or OPENAI_API_KEY)');
      }
      break;
    }
    default: {
      missingVars.push(`Unknown AI_PROVIDER '${provider}'. Valid options: openrouter, nvidia, openai, ollama, groq, custom`);
      break;
    }
  }

  const isValid = missingVars.length === 0;

  if (!isValid && logErrors) {
    logger.error(`\n=================================================================`);
    logger.error(`[AI CONFIGURATION ERROR] Missing Required Environment Variables!`);
    logger.error(`AI_PROVIDER is set to '${provider}', but the following required variables are missing:`);
    missingVars.forEach(v => {
      logger.error(`  -> ${v}`);
    });
    logger.error(`Please check your server/.env file and add the required variables.`);
    logger.error(`=================================================================\n`);
  }

  return {
    provider,
    apiKey,
    baseURL,
    defaultHeaders,
    model,
    isValid,
    missingVars
  };
}
