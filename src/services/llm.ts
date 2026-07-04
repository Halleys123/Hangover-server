import type {
  ChatMessage,
  ValidationResult,
  CanvasNode,
  CanvasEdge,
} from '../types/index.js';
import { openaiService } from './openaiService.js';

/**
 * Generate an AI chat response using our configured OpenAI/Ollama service.
 */
export async function generateChatResponse(
  message: string,
  history: ChatMessage[],
  componentContext: string,
): Promise<string> {
  return await openaiService.generateChatResponse(message, { componentContext, history });
}

/**
 * Validate circuit nodes and edges using Ollama/OpenAI/OpenRouter.
 */
export async function validateCircuit(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): Promise<ValidationResult> {
  const systemPrompt = `You are an expert electronic hardware safety validation AI. Analyze the circuit wiring and return strict JSON with validation status and any compatibility issues.`;
  const prompt = `Analyze these circuit nodes and edges for hardware compatibility issues (voltage mismatches, current limits, missing pull-ups).
Nodes: ${JSON.stringify(nodes)}
Edges: ${JSON.stringify(edges)}
Return JSON with status and issues array.`;

  const response = await openaiService.generateJSONResponse(systemPrompt, prompt);
  return {
    valid: !response.toLowerCase().includes('hazard') && !response.toLowerCase().includes('unsafe'),
    issues: []
  };
}
