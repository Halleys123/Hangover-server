import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

export interface AIContextLogPayload {
  type: string;
  model: string;
  query?: string;
  isCanvasContextSent?: boolean;
  canvasContext?: any;
  cogneeContext?: any;
  projectMetadata?: any;
  systemPrompt?: string;
  userPrompt?: string;
}

/**
 * Logs AI chat prompts and context to a local file in the project root directory
 * instead of dumping large prompt context into the terminal console.
 */
export function logAIContextToFile(data: AIContextLogPayload): void {
  try {
    const timestamp = new Date().toISOString();
    let logText = `=== [${timestamp}] AI PROMPT & CONTEXT LOG (${data.type}) ===\n`;
    logText += `Model: ${data.model}\n`;
    
    if (data.query) {
      logText += `Query: "${data.query}"\n`;
    }
    if (data.isCanvasContextSent !== undefined) {
      logText += `Canvas Context Sent To Model: ${data.isCanvasContextSent}\n`;
    }
    if (data.projectMetadata) {
      logText += `Project Metadata:\n${JSON.stringify(data.projectMetadata, null, 2)}\n`;
    }
    if (data.canvasContext) {
      logText += `Canvas Context (Nodes & Edges):\n${JSON.stringify(data.canvasContext, null, 2)}\n`;
    }
    if (data.cogneeContext) {
      logText += `Cognee Graph & Chunk Context:\n${JSON.stringify(data.cogneeContext, null, 2)}\n`;
    }
    if (data.systemPrompt) {
      logText += `System Prompt:\n${data.systemPrompt}\n`;
    }
    if (data.userPrompt) {
      logText += `User Prompt:\n${data.userPrompt}\n`;
    }
    logText += `=================================================================\n\n`;

    // Determine root project directory (parent of server or current dir)
    const currentDir = process.cwd();
    const isServerDir = currentDir.replace(/\\/g, '/').endsWith('/server');
    const rootDir = isServerDir ? path.resolve(currentDir, '..') : currentDir;

    const logFilePathRoot = path.join(rootDir, 'ai_context.log');
    const logFilePathServer = path.join(currentDir, 'ai_context.log');

    fs.appendFileSync(logFilePathRoot, logText, 'utf8');
    if (logFilePathRoot !== logFilePathServer) {
      try {
        fs.appendFileSync(logFilePathServer, logText, 'utf8');
      } catch {
        // Ignore secondary write failure
      }
    }
    logger.info(`[AI Context] Logged ${data.type} context to local file: ${logFilePathRoot}`);
  } catch (err: any) {
    logger.error(`[AI Context] Failed to log AI context to file:`, err.message || err);
  }
}
