import type {
  ChatMessage,
  ValidationResult,
  CanvasNode,
  CanvasEdge,
} from '../types/index.js';

/**
 * Generate an AI chat response for a user message.
 *
 * TODO: Replace with real LLM integration.
 * Suggested providers: OpenAI (gpt-4o), Anthropic (claude-3-5-sonnet), local (ollama).
 *
 * The LLM should receive:
 * - systemPrompt: hardware design assistant persona + project context
 * - history: prior chat messages for multi-turn conversation
 * - message: the current user query
 * - componentContext: relevant component specs from Cognee knowledge graph
 */
export async function generateChatResponse(
  _message: string,
  _history: ChatMessage[],
  _componentContext: string,
): Promise<string> {
  throw new Error('LLM_NOT_CONFIGURED');
}

/**
 * Validate circuit nodes and edges for hardware compatibility issues.
 *
 * TODO: Replace with real LLM integration.
 * The LLM should analyze:
 * - Voltage level mismatches between connected pins (e.g. 5V → 3.3V)
 * - Current draw vs. supply capacity
 * - Protocol compatibility (I2C address conflicts, SPI bus collisions)
 * - Missing pull-up/pull-down resistors
 *
 * Returns a structured ValidationResult with severity-tagged issues.
 */
export async function validateCircuit(
  _nodes: CanvasNode[],
  _edges: CanvasEdge[],
): Promise<ValidationResult> {
  throw new Error('LLM_NOT_CONFIGURED');
}
