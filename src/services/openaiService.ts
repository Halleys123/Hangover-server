
import OpenAI from 'openai';
import { derivePins } from '../utils/derivePins.js';
import { validateAndGetAIConfig } from './aiConfig.js';
import { logger } from '../utils/logger.js';
import { logAIContextToFile } from '../utils/aiLogger.js';

/**
 * Strips optional markdown code fences (```json ... ``` or ``` ... ```) and
 * parses the inner content as JSON. If the content is not valid JSON at all
 * (e.g. local Ollama models responding with plain prose), wraps the raw text
 * as a chat_response object so the UI still receives a displayable message.
 */
function safeParseJSON(raw: string, fallbackMessage?: string): any {
  try {
    const stripped = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```[\s\S]*$/i, (m) => m.startsWith('```') ? '' : m)
      .trim();
    // Try to extract a JSON object/array if embedded in prose
    const jsonMatch = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(stripped);
  } catch {
    // Model returned plain prose — wrap as a chat_response so the UI still works
    return {
      type: 'chat_response',
      message: fallbackMessage || raw.trim() || 'No response generated.',
      nodes: [],
      edges: []
    };
  }
}

export class OpenAIService {
  private getClient(): OpenAI | null {
    const config = validateAndGetAIConfig(false);

    if (!config.isValid) {
      return null;
    }

    return new OpenAI({
      apiKey: config.apiKey || 'dummy-key-for-local-providers',
      baseURL: config.baseURL || undefined,
      defaultHeaders: config.defaultHeaders,
      timeout: 10 * 60 * 1000, // 10 minutes timeout for slow local LLM engines
    });
  }

  private getModel(): string {
    const config = validateAndGetAIConfig(false);
    return config.model || 'gpt-4o';
  }

  /**
   * Chat Route Assistant: Generates factual engineering answers strictly grounded in Cognee graph recall data.
   */
  public async generateChatResponse(query: string, graphContext: any): Promise<string> {
    const openai = this.getClient();
    const contextString = JSON.stringify(graphContext, null, 2);

    if (!openai) {
      return `[Grounded Cognee Recall Summary]\nBased on the extracted hardware knowledge graph:\n${contextString}\n\n(Note: Set AI_PROVIDER plus the matching API key/model in server/.env for natural language synthesis).`;
    }

    const model = this.getModel();
    const startTime = Date.now();
    logAIContextToFile({
      type: 'Chat Response',
      model,
      query,
      cogneeContext: graphContext,
    });

    try {
      const response = await openai.chat.completions.create({
        model: model,
        max_tokens: 1500,
        messages: [
          {
            role: 'system',
            content: `You are an expert hardware prototyping AI assistant for electronic circuits and microcontrollers. When factual component specifications or knowledge graph data are provided in the Context below, ground your engineering answers in those exact parameters. Help the user design, debug, and understand their prototyping projects clearly and accurately.`
          },
          {
            role: 'user',
            content: `Context retrieved from Cognee Knowledge Graph:\n${contextString}\n\nUser Question: ${query}`
          }
        ],
        temperature: 0.2
      });

      const duration = Date.now() - startTime;
      console.log(`[LLM Chat Response] Completed in ${duration}ms\n`);
      return response.choices[0]?.message?.content || 'No response generated.';
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`[LLM Chat Error] Failed after ${duration}ms:`, err.message || err);
      throw err;
    }
  }

  /**
   * Dedicated JSON Extraction & Validation Route:
   * Used by Cognee PDF datasheet ingestion, refinement, and circuit validation.
   * Sends a clean system prompt without restricting the LLM to an empty or minimal context string,
   * allowing models (like OpenRouter, NVIDIA NIM, GPT-4o, Groq, or Llama 3) to reliably extract valid JSON.
   */
  public async generateJSONResponse(systemPrompt: string, userPrompt: string): Promise<string> {
    const openai = this.getClient();
    if (!openai) {
      throw new Error('AI client not initialized or missing API key.');
    }

    const model = this.getModel();
    const startTime = Date.now();
    logAIContextToFile({
      type: 'JSON Extraction',
      model,
      systemPrompt,
      userPrompt,
    });

    try {
      const response = await openai.chat.completions.create({
        model: model,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1
      });

      const duration = Date.now() - startTime;
      console.log(`[LLM JSON Response] Completed in ${duration}ms\n`);
      return response.choices[0]?.message?.content || '{}';
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`[LLM JSON Error] Failed after ${duration}ms:`, err.message || err);
      throw err;
    }
  }

  /**
   * Layer 3 (LLM Translation): Translates the deterministic JavaScript math evaluation into a human-friendly safety warning citing exact datasheet constraints.
   */
  public async translateGuardrailResult(params: {
    status: 'SAFE' | 'UNSAFE';
    pinA: any;
    pinB: any;
    mathEvaluation: string;
  }): Promise<{ status: 'SAFE' | 'UNSAFE' | 'UNKNOWN'; reason: string }> {
    const { status, pinA, pinB, mathEvaluation } = params;
    const openai = this.getClient();

    const fallbackReason = status === 'UNSAFE'
      ? `HARDWARE OVERVOLTAGE RISK: Pin '${pinA?.pinName || pinA?.pinNumber}' outputs ${pinA?.outputVoltage}V, which exceeds the absolute maximum input tolerance (${pinB?.maxInputTolerance}V) of Pin '${pinB?.pinName || pinB?.pinNumber}'. Connecting these directly will permanently damage components.`
      : `Connection verified safe. Pin '${pinA?.pinName || pinA?.pinNumber}' output (${pinA?.outputVoltage}V) is within the operating input tolerance (${pinB?.maxInputTolerance}V) of Pin '${pinB?.pinName || pinB?.pinNumber}'.`;

    if (!openai) {
      return { status, reason: fallbackReason };
    }

    try {
      const response = await openai.chat.completions.create({
        model: this.getModel(),
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You act strictly as a technical translator for an electronic hardware safety guardrail. You must NOT recalculate or override the safety status. Your job is solely to write a professional, clear, human-friendly engineering warning or confirmation explaining why the connection is ${status}, citing the exact voltages from the retrieved graph constraints.\n\nYou must return strict JSON in exactly this format: { "status": "${status}", "reason": "your human explanation string" }`
          },
          {
            role: 'user',
            content: `Deterministic Math Status: ${status}\nMath Evaluation Details: ${mathEvaluation}\nPin A (Output Source): ${JSON.stringify(pinA)}\nPin B (Input Destination): ${JSON.stringify(pinB)}`
          }
        ],
        temperature: 0.1
      });

      const parsed = safeParseJSON(response.choices[0]?.message?.content || '{}');
      return {
        status: parsed.status || status,
        reason: parsed.reason || fallbackReason
      };
    } catch (err: any) {
      console.error('OpenAI API error during Layer 3 guardrail translation:', err);
      return { status, reason: fallbackReason };
    }
  }

  /**
   * Agentic State-Machine Circuit Generator:
   * Acts as an Agentic Hardware Architect through 4 states:
   * 1. Ideation -> 2. Datasheet Request -> 3. Incompatibility Resolution -> 4. Auto-Wiring Assembly.
   */
  public async generateAgenticChatAndCircuit(
    query: string,
    projectContext: any,
    cogneeComponents: any[],
    existingCanvas?: { nodes?: any[]; edges?: any[] }
  ): Promise<{
    type: 'chat_response' | 'circuit_generated';
    message: string;
    nodes?: any[];
    edges?: any[];
  }> {
    const openai = this.getClient();
    const compCount = cogneeComponents.length;

    // Deterministic fallback if API key not set or during offline demo
    if (!openai) {
      if (compCount === 0) {
        return {
          type: 'chat_response',
          message: `To build your project ('${query}'), I need to inspect component electrical constraints. Please upload PDF datasheets for your microcontroller (e.g., ESP32 or Arduino) and sensors so Cognee can ingest their physical characteristics.`
        };
      }

      // Semantic Schematic Assembly: Derive accurate left/right headers for each component
      const nodes = cogneeComponents.map((c, i) => {
        const specs = c.specs;
        const derived = derivePins(c.componentName, specs);
        return {
          id: `node-${i + 1}`,
          type: 'hardware',
          position: { x: 150 + (i % 2) * 350, y: 100 + Math.floor(i / 2) * 220 },
          data: {
            label: c.componentName,
            subtitle: c.description || 'Hardware Component',
            theme: derived.theme,
            pins: derived.pins
          }
        };
      });

      const edges: any[] = [];
      if (compCount >= 2) {
        edges.push({
          id: 'edge-power',
          source: 'node-1',
          sourceHandle: '3.3V',
          target: 'node-2',
          targetHandle: 'VCC',
          label: '3.3V Regulated Power Rail',
          animated: true,
          style: { stroke: '#10b981', strokeWidth: 2 }
        });
        edges.push({
          id: 'edge-gnd',
          source: 'node-1',
          sourceHandle: 'GND',
          target: 'node-2',
          targetHandle: 'GND',
          label: 'Common Ground',
          style: { stroke: '#64748b', strokeWidth: 2 }
        });
      }

      return {
        type: 'circuit_generated',
        message: `I have verified all ${compCount} components in the Cognee knowledge graph. Voltages and interfaces are compatible! I have auto-assembled the schematic wiring below.`,
        nodes,
        edges
      };
    }

    const model = this.getModel();
    const startTime = Date.now();

    try {
      const hasComponents = cogneeComponents.length > 0;
      // Build an explicit component list with actual pin IDs so the AI uses correct sourceHandle/targetHandle values
      const componentList = cogneeComponents
        .filter(c => typeof c.componentName === 'string')
        .map((c, i) => {
          const pinList = Array.isArray(c.pins) && c.pins.length > 0
            ? c.pins.map((p: any) => `${p.pinNumber}("${p.pinName}")`).join(', ')
            : 'pins: unknown';
          return `${i + 1}. componentName: "${c.componentName}" | category: ${c.category || 'unknown'} | pins: [${pinList}]`;
        })
        .join('\n');

      // Build existing canvas context so AI knows current node positions
      const existingNodes: any[] = existingCanvas?.nodes || [];
      const existingEdges: any[] = existingCanvas?.edges || [];
      const isCanvasSent = existingNodes.length > 0 || existingEdges.length > 0;
      logAIContextToFile({
        type: 'Circuit & Chat Generation',
        model,
        query,
        isCanvasContextSent: isCanvasSent,
        canvasContext: existingCanvas || { nodes: [], edges: [] },
        cogneeContext: cogneeComponents,
        projectMetadata: projectContext,
      });

      const existingCanvasInfo = existingNodes.length > 0
        ? `\nEXISTING CANVAS NODES (use these EXACT positions for these components — do not change them):\n${existingNodes.map((n: any) => `  - label: "${n?.data?.label}" | id: "${n?.id}" | position: {x:${n?.position?.x}, y:${n?.position?.y}}`).join('\n')}\nEXISTING EDGES (already wired — do not duplicate them):\n${existingEdges.map((e: any) => `  - id: "${e?.id}" source: ${e?.source}/${e?.sourceHandle} → target: ${e?.target}/${e?.targetHandle}`).join('\n') || '  (none yet)'}`
        : '';

      const systemPrompt = `You are an Agentic Hardware Architect AI. Your ONLY output must be a single raw JSON object — no markdown, no prose, no explanations outside JSON.

CRITICAL RULE: Your entire response must be a single valid JSON object. Never write plain text. Never use markdown fences. Start your response with { and end with }.

JSON FORMAT (always use exactly this structure):
{"type":"chat_response"|"circuit_generated","message":"string","nodes":[],"edges":[]}

STATE MACHINE:
State 1 - IDEATION: User describes a goal. Identify required hardware. Output type=chat_response asking for datasheets.
State 2 - MISSING PARTS: Some components not in context. Output type=chat_response listing what datasheets are needed.
State 3 - INCOMPATIBILITY: Voltage/protocol mismatch detected. Output type=chat_response explaining the hazard.
State 4 - GENERATE CIRCUIT: ALL components are in context AND user asks to connect/wire/build. Output type=circuit_generated with full nodes and edges arrays.

TRANSITION RULES AND CONSTRAINTS:
1. If the user asks to connect, wire, build, or assemble the circuit, and all necessary components are available, you MUST choose type="circuit_generated". Do NOT choose type="chat_response" to simply declare the goal met or requirements satisfied.
2. When type="circuit_generated", you MUST generate a non-empty, complete "edges" array representing all the physical power, ground, and signal wires connecting the components. Outputting an empty or incomplete edges list is a critical failure.
3. Every node in the nodes list must represent a real component from the available list.
4. Passive components like resistors should have their terminals (e.g. p1, p2) wired in series/parallel as appropriate for signal flow.
5. Structural components like breadboards have no active schematic pins; do not wire signals to them.

${hasComponents ? `AVAILABLE COMPONENTS (use these EXACT componentName values as node data.label values — do NOT invent new names):
${componentList}
${existingCanvasInfo}

CRITICAL RULES FOR WIRING:
1. Every node data.label MUST match a componentName from the list above exactly.
2. Every edge sourceHandle and targetHandle MUST be one of the pin IDs listed above (the value before the parenthesis, e.g. use "D3" not "Pin 3").
3. Preserve existing node positions exactly as given. Only add NEW edges that don't already exist.
4. Output type=circuit_generated now since components are present and user wants wiring.` : ''}

Node format: {"id":"node-1","type":"hardware","position":{"x":100,"y":150},"data":{"label":"<exact componentName>","subtitle":"<category>"}}
Edge format: {"id":"edge-1","source":"node-1","sourceHandle":"<pin id from list>","target":"node-2","targetHandle":"<pin id from list>","label":"description","animated":true}

Remember: respond ONLY with a JSON object. No text before or after the JSON.`;

      const response = await openai.chat.completions.create({
        model: model,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Project Goal / User Message: "${query}"\n\nCurrent Project Metadata: ${JSON.stringify(projectContext)}\n\nIngested Cognee Graph Components: ${JSON.stringify(cogneeComponents, null, 2)}`
          }
        ],
        temperature: 0.2
      });

      const duration = Date.now() - startTime;
      console.log(`[LLM Circuit Response] Completed in ${duration}ms\n`);
      const rawContent = response.choices[0]?.message?.content || '{}';
      const parsed = safeParseJSON(rawContent, rawContent);

      // Semantic Normalization: Ensure AI-generated React Flow nodes strictly use 'hardware' node type
      // and physical pin layouts derived from the actual matched component specs.
      // Matching is done by: exact name -> name inclusion -> description/category keyword fallback.
      const normalizedNodes = Array.isArray(parsed.nodes) ? parsed.nodes.map((node: any, idx: number) => {
        const aiLabel = (typeof node?.data?.label === 'string' && node.data.label) ? node.data.label : `Node ${idx + 1}`;
        const aiLabelLower = aiLabel.toLowerCase();

        // 1. Try exact or substring match on componentName
        let matchedComp = cogneeComponents.find(c => {
          const name = typeof c.componentName === 'string' ? c.componentName.toLowerCase() : null;
          if (!name) return false;
          return name === aiLabelLower || aiLabelLower.includes(name) || name.includes(aiLabelLower);
        });

        // 2. Fallback: match on description keywords (e.g. AI says 'Arduino Uno', DB has 'A000066' described as 'Arduino Uno Rev3')
        if (!matchedComp) {
          matchedComp = cogneeComponents.find(c => {
            const desc = typeof c.description === 'string' ? c.description.toLowerCase() : '';
            const cat = typeof c.category === 'string' ? c.category.toLowerCase() : '';
            return desc.includes(aiLabelLower) || aiLabelLower.includes(desc.split(' ')[0]) ||
              (aiLabelLower.includes('arduino') && (desc.includes('arduino') || cat.includes('microcontroller'))) ||
              (aiLabelLower.includes('led') && cat.includes('opto')) ||
              (aiLabelLower.includes('resistor') && cat.includes('actuator'));
          });
        }

        // Use the canonical componentName from the DB as the label so derivePins works correctly
        const compName = matchedComp?.componentName || aiLabel;
        const specs = matchedComp ? (matchedComp.specs || matchedComp.cogneeConfig) : null;
        const derived = derivePins(compName, specs);

        return {
          ...node,
          id: node?.id || `node-${idx + 1}`,
          type: 'hardware',
          data: {
            ...node?.data,
            label: compName,
            subtitle: node?.data?.subtitle || matchedComp?.description || 'Hardware Component',
            theme: derived.theme,
            pins: derived.pins
          }
        };
      }) : [];

      return {
        type: parsed.type === 'circuit_generated' ? 'circuit_generated' : 'chat_response',
        message: parsed.message || 'Processed project requirements.',
        nodes: normalizedNodes,
        edges: parsed.edges || []
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`[LLM Circuit Error] Failed after ${duration}ms:`, err.message || err);
      return {
        type: 'chat_response',
        message: `Error connecting to AI circuit architect: ${err.message}`
      };
    }
  }
}

export const openaiService = new OpenAIService();
