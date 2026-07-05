import dotenv from 'dotenv';
dotenv.config({ override: true });

export interface Config {
  MONGODB_URI: string;
  JWT_SECRET: string;
  PORT: number;
  CLIENT_ORIGIN: string;
  AI_PROVIDER: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_MODEL?: string;
  NVIDIA_BASE_URL?: string;
  GROQ_API_KEY?: string;
  GROQ_BASE_URL?: string;
  GROQ_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  OLLAMA_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  COGNEE_BASE_URL?: string;
  COGNEE_API_KEY?: string;
}

function getEnv(key: string, required = false, fallback = ''): string {
  const val = process.env[key];
  if (!val && required) {
    throw new Error(`Environment variable ${key} is required but missing!`);
  }
  return val || fallback;
}

function getEnvNum(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export const env: Config = {
  MONGODB_URI: getEnv('MONGODB_URI', false, 'mongodb://localhost:27017/hangover'),
  JWT_SECRET: getEnv('JWT_SECRET', false, 'change-this-secret-in-production'),
  PORT: getEnvNum('PORT', 3000),
  CLIENT_ORIGIN: getEnv('CLIENT_ORIGIN', false, 'http://localhost:5173'),
  AI_PROVIDER: getEnv('AI_PROVIDER', false, 'openrouter').toLowerCase().trim(),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || process.env.LLM_BASE_URL,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || process.env.LLM_MODEL,
  OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL,
  OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY || process.env.LLM_API_KEY,
  NVIDIA_MODEL: process.env.NVIDIA_MODEL || process.env.NIM_MODEL || process.env.LLM_MODEL,
  NVIDIA_BASE_URL: process.env.NVIDIA_BASE_URL || process.env.NIM_BASE_URL || process.env.LLM_BASE_URL,
  GROQ_API_KEY: process.env.GROQ_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
  GROQ_BASE_URL: process.env.GROQ_BASE_URL || process.env.LLM_BASE_URL,
  GROQ_MODEL: process.env.GROQ_MODEL || process.env.LLM_MODEL,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || process.env.LLM_BASE_URL,
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || process.env.LLM_MODEL,
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || process.env.LLM_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL || process.env.LLM_MODEL,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
  COGNEE_BASE_URL: process.env.COGNEE_BASE_URL || process.env.COGNEE_API_URL,
  COGNEE_API_KEY: process.env.COGNEE_API_KEY,
};

export function validateConfig(): void {
  const provider = env.AI_PROVIDER;
  let keyMissing = false;

  if (provider === 'openrouter' && !env.OPENROUTER_API_KEY) keyMissing = true;
  else if (provider === 'nvidia' && !env.NVIDIA_API_KEY) keyMissing = true;
  else if (provider === 'openai' && !env.OPENAI_API_KEY) keyMissing = true;
  else if (provider === 'groq' && !env.GROQ_API_KEY) keyMissing = true;

  if (keyMissing) {
    console.warn(`[WARNING] AI_PROVIDER is set to '${provider}', but its API key is not configured in the environment variables.`);
  }
}
