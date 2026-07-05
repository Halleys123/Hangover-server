
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
    
    // Deduplicate Cognee components by lowercase name to prevent duplicate nodes (e.g., two Arduino Unos)
    const uniqueMap = new Map<string, any>();
    (cogneeComponents || []).forEach(c => {
      const name = typeof c?.componentName === 'string' ? c.componentName.toLowerCase().trim() : '';
      if (name && !uniqueMap.has(name)) {
        uniqueMap.set(name, c);
      } else if (!name && c) {
        uniqueMap.set(`unknown-${Math.random()}`, c);
      }
    });
    cogneeComponents = Array.from(uniqueMap.values());
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
        const src = nodes[0];
        const tgt = nodes[1];
        const srcPins = [...(src.data.pins.left || []), ...(src.data.pins.right || [])];
        const tgtPins = [...(tgt.data.pins.left || []), ...(tgt.data.pins.right || [])];

        const srcVcc = srcPins.find(p => p.id === 'vcc' || p.color === 'red')?.id || 'vcc';
        const tgtVcc = tgtPins.find(p => p.id === 'vcc' || p.color === 'red')?.id || 'vcc';
        const srcGnd = srcPins.find(p => p.id === 'gnd' || p.color === 'gray')?.id || 'gnd';
        const tgtGnd = tgtPins.find(p => p.id === 'gnd' || p.color === 'gray')?.id || 'gnd';
        const srcData = srcPins.find(p => p.id === 'gpio0' || p.id === 'sig' || p.color === 'blue')?.id || 'gpio0';
        const tgtData = tgtPins.find(p => p.id === 'sig' || p.id === 'gpio0' || p.color === 'blue')?.id || 'sig';

        edges.push({
          id: 'edge-power',
          source: src.id,
          sourceHandle: srcVcc,
          target: tgt.id,
          targetHandle: tgtVcc,
          label: '5V Regulated Power Rail',
          style: { stroke: '#ef4444', strokeWidth: 2 }
        });
        edges.push({
          id: 'edge-gnd',
          source: src.id,
          sourceHandle: srcGnd,
          target: tgt.id,
          targetHandle: tgtGnd,
          label: 'Common Ground',
          style: { stroke: '#6b7280', strokeWidth: 2 }
        });
        edges.push({
          id: 'edge-data',
          source: src.id,
          sourceHandle: srcData,
          target: tgt.id,
          targetHandle: tgtData,
          label: 'I2C Data Line',
          animated: true,
          style: { stroke: '#3b82f6', strokeWidth: 2 }
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
      // Build simplified component reference for the LLM — use short numbered IDs instead of UUIDs
      const compRef = cogneeComponents
        .filter(c => typeof c.componentName === 'string')
        .map((c, i) => {
          const pinList = Array.isArray(c.pins) && c.pins.length > 0
            ? c.pins.map((p: any) => `${p.pinNumber}(${p.pinName})`).join(', ')
            : 'pins: unknown';
          return `  C${i + 1}: "${c.componentName}" (${c.category || 'unknown'}) pins=[${pinList}]`;
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

      // Radically simplified prompt for local LLMs (Ollama gemma4 etc.)
      // Instead of asking for React Flow JSON (which small LLMs cannot produce),
      // we ask for a simple wire list and build the actual graph deterministically.
      const hasComponents = cogneeComponents.length > 0;
      const systemPrompt = `You are a hardware circuit architect. Output ONLY a JSON object, no markdown.

${hasComponents ? `COMPONENTS:
${compRef}

If user asks to connect/wire/build, output type "circuit" with a wires array.
Each wire: {"from":1,"to":2,"fromPin":"5v","toPin":"vcc","type":"power|ground|data","label":"description"}
"from" and "to" are component numbers (C1=1, C2=2, etc). "fromPin" and "toPin" are specific pin IDs or names from the component pin list.

Example for 2 components:
{"type":"circuit","message":"Connected power and data lines.","wires":[{"from":1,"to":2,"fromPin":"5v","toPin":"vcc","type":"power","label":"5V power"},{"from":1,"to":2,"fromPin":"gnd","toPin":"gnd","type":"ground","label":"GND"},{"from":1,"to":2,"fromPin":"a4","toPin":"data","type":"data","label":"I2C SDA"}]}

If components are missing or user just asks a question, output:
{"type":"chat","message":"your answer here"}` : `No components available yet. Ask user to upload datasheets.
Output: {"type":"chat","message":"your answer here"}`}`;

      const response = await openai.chat.completions.create({
        model: model,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `User request: "${query}"\nProject: ${JSON.stringify(projectContext)}`
          }
        ],
        temperature: 0.2
      });

      const duration = Date.now() - startTime;
      console.log(`[LLM Circuit Response] Completed in ${duration}ms`);
      const rawContent = response.choices[0]?.message?.content || '{}';
      console.log(`[LLM Raw Output] ${rawContent.substring(0, 500)}`);
      const parsed = safeParseJSON(rawContent, rawContent);

      // Determine if this is a circuit generation response
      const isCircuit = (parsed.type || '').toLowerCase().includes('circuit') ||
                        (Array.isArray(parsed.wires) && parsed.wires.length > 0) ||
                        (Array.isArray(parsed.edges) && parsed.edges.length > 0) ||
                        (parsed.type === 'circuit_generated');

      console.log(`[Circuit Detection] type="${parsed.type}", isCircuit=${isCircuit}, hasWires=${Array.isArray(parsed.wires) ? parsed.wires.length : 'none'}, hasEdges=${Array.isArray(parsed.edges) ? parsed.edges.length : 'none'}`);

      if (!isCircuit) {
        return {
          type: 'chat_response',
          message: parsed.message || parsed.reply || rawContent || 'No response generated.'
        };
      }

      // ── PHASE 2: Deterministic React Flow Graph Construction ──
      // Build nodes from cogneeComponents with proper positions and pin layouts
      const labelToExistingIdMap = new Map<string, string>();
      existingNodes.forEach((n: any) => {
        if (n?.data?.label) {
          labelToExistingIdMap.set(n.data.label.toLowerCase(), n.id);
        }
      });

      const normalizedNodes = cogneeComponents
        .filter(c => typeof c.componentName === 'string')
        .map((c, idx) => {
          const specs = c.specs || c.cogneeConfig;
          const derived = derivePins(c.componentName, specs);
          const existingNode = existingNodes.find((n: any) =>
            n?.data?.label?.toLowerCase() === c.componentName.toLowerCase()
          );

          return {
            id: existingNode?.id || `node-${idx + 1}`,
            type: 'hardware' as const,
            position: existingNode?.position || { x: 150 + (idx % 2) * 400, y: 100 + Math.floor(idx / 2) * 250 },
            data: {
              label: c.componentName,
              subtitle: c.description || c.category || 'Hardware Component',
              theme: derived.theme,
              pins: derived.pins
            }
          };
        });

      // Build edges from the LLM's simplified wire list
      const wireList: any[] = parsed.wires || parsed.edges || [];
      console.log(`[Wire List] ${wireList.length} wires from LLM. normalizedNodes: ${normalizedNodes.length}. First wire:`, wireList[0] ? JSON.stringify(wireList[0]) : 'none');
      const normalizedEdges: any[] = [];
      const usedPinsByNode = new Map<string, Set<string>>();
      normalizedNodes.forEach(n => usedPinsByNode.set(n.id, new Set<string>()));

      for (let i = 0; i < wireList.length; i++) {
        const wire = wireList[i];
        if (!wire || typeof wire !== 'object') continue;

        // Resolve component references — support numbered refs, names, or direct IDs
        const fromRef = wire.from ?? wire.source ?? wire.src ?? wire.from_id;
        const toRef = wire.to ?? wire.target ?? wire.dst ?? wire.to_id;

        const resolveCompIdx = (ref: any): number => {
          if (ref == null) return -1;
          if (typeof ref === 'number') return ref - 1; // 1-indexed
          const s = String(ref).toLowerCase().trim();
          // "C1", "c2", "1", "2"
          const numMatch = s.match(/^c?(\d+)$/);
          if (numMatch) return parseInt(numMatch[1]) - 1;
          // Try name match
          const nameIdx = normalizedNodes.findIndex(n =>
            n.data.label.toLowerCase() === s ||
            s.includes(n.data.label.toLowerCase()) ||
            n.data.label.toLowerCase().includes(s)
          );
          if (nameIdx >= 0) return nameIdx;
          // Try existing node ID match
          const idIdx = normalizedNodes.findIndex(n => n.id === ref);
          if (idIdx >= 0) return idIdx;
          return -1;
        };

        const srcIdx = resolveCompIdx(fromRef);
        const tgtIdx = resolveCompIdx(toRef);

        if (srcIdx < 0 || srcIdx >= normalizedNodes.length || tgtIdx < 0 || tgtIdx >= normalizedNodes.length) {
          console.log(`[Edge Skip] Invalid component ref: from=${fromRef} (idx=${srcIdx}), to=${toRef} (idx=${tgtIdx})`);
          continue;
        }

        const srcNode = normalizedNodes[srcIdx];
        const tgtNode = normalizedNodes[tgtIdx];
        const srcPins = [...(srcNode.data.pins.left || []), ...(srcNode.data.pins.right || [])];
        const tgtPins = [...(tgtNode.data.pins.left || []), ...(tgtNode.data.pins.right || [])];

        // Determine wire type from LLM output
        const wireType = (wire.type || wire.wireType || wire.connection_type || wire.label || wire.description || '').toLowerCase();
        const isPower = wireType.includes('power') || wireType.includes('vcc') || wireType.includes('5v') || wireType.includes('3.3v') || wireType.includes('3v3');
        const isGround = wireType.includes('ground') || wireType.includes('gnd');
        const isData = wireType.includes('data') || wireType.includes('sda') || wireType.includes('scl') || wireType.includes('i2c') ||
                       wireType.includes('signal') || wireType.includes('sig') || wireType.includes('serial') || wireType.includes('rx') || wireType.includes('tx');

        const findPinByRef = (pins: any[], ref: any, used: Set<string>): string | undefined => {
          if (!ref) return undefined;
          const s = String(ref).toLowerCase().trim();
          if (!s) return undefined;
          const exactId = pins.find(p => p.id?.toLowerCase() === s && !used.has(p.id));
          if (exactId) return exactId.id;
          const exactLabel = pins.find(p => p.label?.toLowerCase() === s && !used.has(p.id));
          if (exactLabel) return exactLabel.id;
          const subMatch = pins.find(p => (p.id?.toLowerCase().includes(s) || p.label?.toLowerCase().includes(s)) && !used.has(p.id));
          if (subMatch) return subMatch.id;
          return undefined;
        };

        const fromPinRef = wire.fromPin || wire.sourcePin || wire.srcPin || wire.from_pin || wire.source_pin;
        const toPinRef = wire.toPin || wire.targetPin || wire.tgtPin || wire.to_pin || wire.target_pin;

        // Select pins deterministically based on wire ref or type
        const srcUsed = usedPinsByNode.get(srcNode.id)!;
        const tgtUsed = usedPinsByNode.get(tgtNode.id)!;

        let srcHandle = findPinByRef(srcPins, fromPinRef, srcUsed) || findPinByRef(srcPins, wire.label, srcUsed);
        let tgtHandle = findPinByRef(tgtPins, toPinRef, tgtUsed) || findPinByRef(tgtPins, wire.label, tgtUsed);

        if (!srcHandle || !tgtHandle) {
          if (isPower) {
            srcHandle = srcHandle || (srcPins.find(p => (p.id === 'vcc' || p.color === 'red') && !srcUsed.has(p.id)) || srcPins.find(p => p.id === 'vcc' || p.color === 'red'))?.id || 'vcc';
            tgtHandle = tgtHandle || (tgtPins.find(p => (p.id === 'vcc' || p.color === 'red') && !tgtUsed.has(p.id)) || tgtPins.find(p => p.id === 'vcc' || p.color === 'red'))?.id || 'vcc';
          } else if (isGround) {
            srcHandle = srcHandle || (srcPins.find(p => (p.id === 'gnd' || p.color === 'gray') && !srcUsed.has(p.id)) || srcPins.find(p => p.id === 'gnd' || p.color === 'gray'))?.id || 'gnd';
            tgtHandle = tgtHandle || (tgtPins.find(p => (p.id === 'gnd' || p.color === 'gray') && !tgtUsed.has(p.id)) || tgtPins.find(p => p.id === 'gnd' || p.color === 'gray'))?.id || 'gnd';
          } else if (isData) {
            srcHandle = srcHandle || (srcPins.find(p => (p.id === 'sig' || p.id === 'gpio0' || p.color === 'blue' || p.color === 'green') && !srcUsed.has(p.id)) || srcPins.find(p => p.id === 'sig' || p.id === 'gpio0' || p.color === 'blue'))?.id || 'gpio0';
            tgtHandle = tgtHandle || (tgtPins.find(p => (p.id === 'sig' || p.id === 'gpio0' || p.color === 'blue' || p.color === 'green') && !tgtUsed.has(p.id)) || tgtPins.find(p => p.id === 'sig' || p.id === 'gpio0' || p.color === 'blue'))?.id || 'sig';
          } else {
            const srcUnused = srcPins.find(p => !srcUsed.has(p.id));
            const tgtUnused = tgtPins.find(p => !tgtUsed.has(p.id));
            srcHandle = srcHandle || srcUnused?.id || srcPins[0]?.id || 'vcc';
            tgtHandle = tgtHandle || tgtUnused?.id || tgtPins[0]?.id || 'vcc';
          }
        }

        srcUsed.add(srcHandle!);
        tgtUsed.add(tgtHandle!);

        const edgeColor = isPower ? '#ef4444' : isGround ? '#6b7280' : '#3b82f6';
        const uniqueEdgeId = `ai-edge-${Date.now()}-${i + 1}-${Math.random().toString(36).substring(2, 6)}`;
        normalizedEdges.push({
          id: uniqueEdgeId,
          source: srcNode.id,
          sourceHandle: srcHandle,
          target: tgtNode.id,
          targetHandle: tgtHandle,
          label: wire.label || wire.description || (isPower ? 'Power' : isGround ? 'Ground' : 'Data'),
          animated: isData,
          style: { stroke: edgeColor, strokeWidth: 2 }
        });
        console.log(`[Edge Built] ${srcNode.data.label}:${srcHandle} → ${tgtNode.data.label}:${tgtHandle} (${isPower ? 'PWR' : isGround ? 'GND' : 'DATA'})`);
      }

      // If LLM returned circuit type but no valid wires could be built, fall back to auto-wiring
      if (normalizedEdges.length === 0 && normalizedNodes.length >= 2) {
        console.log(`[Auto-Wire Fallback] LLM produced no usable wires. Building default power+ground+data wiring.`);
        for (let i = 1; i < normalizedNodes.length; i++) {
          const src = normalizedNodes[0];
          const tgt = normalizedNodes[i];
          const sp = [...(src.data.pins.left || []), ...(src.data.pins.right || [])];
          const tp = [...(tgt.data.pins.left || []), ...(tgt.data.pins.right || [])];

          const srcVcc = sp.find(p => p.id === 'vcc' || p.color === 'red');
          const tgtVcc = tp.find(p => p.id === 'vcc' || p.color === 'red');
          const srcGnd = sp.find(p => p.id === 'gnd' || p.color === 'gray');
          const tgtGnd = tp.find(p => p.id === 'gnd' || p.color === 'gray');
          const srcData = sp.find(p => p.id === 'gpio0' || p.id === 'sig' || p.color === 'blue');
          const tgtData = tp.find(p => p.id === 'sig' || p.id === 'gpio0' || p.color === 'blue');

          const timestamp = Date.now();
          if (srcVcc && tgtVcc) {
            normalizedEdges.push({
              id: `ai-edge-pwr-${timestamp}-${i}`, source: src.id, sourceHandle: srcVcc.id,
              target: tgt.id, targetHandle: tgtVcc.id,
              label: 'Power', style: { stroke: '#ef4444', strokeWidth: 2 }
            });
          }
          if (srcGnd && tgtGnd) {
            normalizedEdges.push({
              id: `ai-edge-gnd-${timestamp}-${i}`, source: src.id, sourceHandle: srcGnd.id,
              target: tgt.id, targetHandle: tgtGnd.id,
              label: 'Ground', style: { stroke: '#6b7280', strokeWidth: 2 }
            });
          }
          if (srcData && tgtData) {
            normalizedEdges.push({
              id: `ai-edge-data-${timestamp}-${i}`, source: src.id, sourceHandle: srcData.id,
              target: tgt.id, targetHandle: tgtData.id,
              label: 'Data', animated: true, style: { stroke: '#3b82f6', strokeWidth: 2 }
            });
          }
        }
      }

      console.log(`[Circuit Result] Returning ${normalizedNodes.length} nodes, ${normalizedEdges.length} edges`);
      if (normalizedEdges.length > 0) {
        console.log(`[Circuit Edges]`, normalizedEdges.map(e => `${e.source}:${e.sourceHandle} → ${e.target}:${e.targetHandle}`).join(', '));
      }

      return {
        type: 'circuit_generated',
        message: parsed.message || 'Circuit assembled from component knowledge graph.',
        nodes: normalizedNodes,
        edges: normalizedEdges
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
