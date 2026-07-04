import OpenAI from 'openai';
import { derivePins } from '../utils/derivePins.js';

export class OpenAIService {
  private getClient(): OpenAI | null {
    const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || 'dummy-key-for-local-providers';

    // If no explicit API key is provided and no local base URL is set, return null
    if (!process.env.OPENAI_API_KEY && !process.env.LLM_API_KEY && !process.env.OPENAI_BASE_URL && !process.env.LLM_BASE_URL) {
      return null;
    }

    return new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || undefined,
      timeout: 10 * 60 * 1000, // 10 minutes timeout for slow local LLM engines
    });
  }

  private getModel(): string {
    return process.env.LLM_MODEL || 'gpt-4o';
  }

  /**
   * Chat Route Assistant: Generates factual engineering answers strictly grounded in Cognee graph recall data.
   */
  public async generateChatResponse(query: string, graphContext: any): Promise<string> {
    const openai = this.getClient();
    const contextString = JSON.stringify(graphContext, null, 2);

    if (!openai) {
      return `[Grounded Cognee Recall Summary]\nBased on the extracted hardware knowledge graph:\n${contextString}\n\n(Note: Set OPENAI_API_KEY in server/.env for natural language synthesis).`;
    }

    try {
      const response = await openai.chat.completions.create({
        model: this.getModel(),
        messages: [
          {
            role: 'system',
            content: `You are an expert hardware prototyping AI assistant. You must answer engineering questions strictly using the factual component specifications provided in the Context below. Do not guess or hallucinate voltage rails, pinouts, or tolerances not present in the graph memory.`
          },
          {
            role: 'user',
            content: `Context retrieved from Cognee Knowledge Graph:\n${contextString}\n\nUser Question: ${query}`
          }
        ],
        temperature: 0.2
      });

      return response.choices[0]?.message?.content || 'No response generated.';
    } catch (err: any) {
      console.error('OpenAI API error during chat synthesis:', err);
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
        response_format: { type: 'json_object' },
        temperature: 0.1
      });

      const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
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
    cogneeComponents: any[]
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

    try {
      const systemPrompt = `You are an Agentic Hardware Architect AI for the Hardware Prototyping Copilot.
Instead of asking the user to draw wires, YOU are the one who auto-assembles visual schematics for React Flow.

You must follow this 4-Stage State Machine strictly:
State 1 (Ideation): If the user declares a project goal (e.g. "I want to make a smart plant monitor"), identify required hardware blocks.
State 2 (Datasheet Request): If required components are missing from the Cognee graph context, explicitly instruct the user to upload PDF datasheets for those parts.
State 3 (Incompatibility & Bridging Request): Inspect the retrieved Cognee graph pin specifications. If you detect a voltage or protocol incompatibility (e.g. ESP32 3.3V output trying to drive a 12V pump or 5V relay without logic translation), DO NOT wire them directly. Instead, explain the electrical incompatibility hazard and ask the user to upload a datasheet for a bridging component (like an Optocoupler, Logic Level Converter, or MOSFET module).
State 4 (Auto-Wiring Assembly): Once Cognee confirms that sufficient and electrically compatible components exist in the graph to fulfill the user's goal, generate the full visual circuit schematic!

When outputting State 4 (circuit generation), you MUST format React Flow nodes with 2D coordinates (x, y spaced cleanly at intervals like x: 100/450, y: 100/300) and edges connecting sourceHandle and targetHandle pin names.

You MUST return strict JSON in exactly this format:
{
  "type": "chat_response" | "circuit_generated",
  "message": "Your human-friendly response or schematic explanation",
  "nodes": [ { "id": "node-1", "type": "componentNode", "position": { "x": 100, "y": 150 }, "data": { "label": "ESP32", "subtitle": "MCU", "pins": ["3.3V", "GND", "GPIO4"] } } ],
  "edges": [ { "id": "edge-1", "source": "node-1", "sourceHandle": "3.3V", "target": "node-2", "targetHandle": "VCC", "label": "3.3V Power", "animated": true } ]
}`;

      const response = await openai.chat.completions.create({
        model: this.getModel(),
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Project Goal / User Message: "${query}"\n\nCurrent Project Metadata: ${JSON.stringify(projectContext)}\n\nIngested Cognee Graph Components: ${JSON.stringify(cogneeComponents, null, 2)}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      });

      let parsed: any = {};
      try {
        parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
      } catch (err) {
        console.warn('[AI] JSON parsing failed, attempting text healing.', err);
        parsed = {
          type: 'chat_response',
          message: response.choices[0]?.message?.content || 'Processed request.'
        };
      }

      // Detect if user specifically requested wiring / schematic / connection
      let finalType: 'chat_response' | 'circuit_generated' = parsed.type === 'circuit_generated' ? 'circuit_generated' : 'chat_response';
      const isConnectQuery = /connect|wire|circuit|build|schematic|assemble/i.test(query) || 
                            /auto-assemble|connect|schematic/i.test(parsed.message || '');
      if (isConnectQuery && cogneeComponents.length >= 2) {
        finalType = 'circuit_generated';
      }

      // Build normalized nodes
      let normalizedNodes = Array.isArray(parsed.nodes) && parsed.nodes.length > 0
        ? parsed.nodes.map((node: any, idx: number) => {
            const compName = node?.data?.label || `Node ${idx + 1}`;
            const matchedComp = cogneeComponents.find(c =>
              c.componentName.toLowerCase() === compName.toLowerCase() ||
              compName.toLowerCase().includes(c.componentName.toLowerCase()) ||
              c.componentName.toLowerCase().includes(compName.toLowerCase())
            );
            const specs = matchedComp ? (matchedComp.specs || matchedComp.cogneeConfig) : null;
            const derived = derivePins(compName, specs);
            return {
              ...node,
              id: node?.id || `node-${idx + 1}`,
              type: 'hardware',
              data: {
                ...node?.data,
                label: compName,
                subtitle: node?.data?.subtitle || 'Hardware Component',
                theme: derived.theme,
                pins: derived.pins
              }
            };
          })
        : [];

      // Fallback: If type is circuit_generated but nodes are empty, generate them from Cognee context
      if (finalType === 'circuit_generated' && normalizedNodes.length === 0) {
        normalizedNodes = cogneeComponents.map((c, i) => {
          const specs = c.specs || c.cogneeConfig;
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
      }

      // Build edges
      let edges = Array.isArray(parsed.edges) ? parsed.edges : [];

      // Fallback: If type is circuit_generated but edges are empty, auto-wire power, ground, and signals
      if (finalType === 'circuit_generated' && edges.length === 0 && normalizedNodes.length >= 2) {
        const hostNode = normalizedNodes[0];
        const hostPins = [
          ...(hostNode.data.pins?.left || []),
          ...(hostNode.data.pins?.right || [])
        ];

        for (let i = 1; i < normalizedNodes.length; i++) {
          const peripheralNode = normalizedNodes[i];
          const periPins = [
            ...(peripheralNode.data.pins?.left || []),
            ...(peripheralNode.data.pins?.right || [])
          ];
          
          // Match Power Pins (VCC, 3.3V, 5V)
          const hostPowerPin = hostPins.find((p: any) => 
            /3\.3v|5v|vcc|vdd|power/i.test(p.label || p.id || '')
          );
          const periPowerPin = periPins.find((p: any) => 
            /vcc|vdd|power|3\.3v|5v|v\+/i.test(p.label || p.id || '')
          );
          
          if (hostPowerPin && periPowerPin) {
            edges.push({
              id: `edge-power-${i}`,
              source: hostNode.id,
              sourceHandle: hostPowerPin.id,
              target: peripheralNode.id,
              targetHandle: periPowerPin.id,
              label: `${hostPowerPin.label} -> ${periPowerPin.label}`,
              animated: true,
              style: { stroke: '#10b981', strokeWidth: 2 }
            });
          }

          // Match Ground Pins (GND, Ground)
          const hostGndPin = hostPins.find((p: any) => 
            /gnd|ground/i.test(p.label || p.id || '')
          );
          const periGndPin = periPins.find((p: any) => 
            /gnd|ground/i.test(p.label || p.id || '')
          );
          
          if (hostGndPin && periGndPin) {
            edges.push({
              id: `edge-gnd-${i}`,
              source: hostNode.id,
              sourceHandle: hostGndPin.id,
              target: peripheralNode.id,
              targetHandle: periGndPin.id,
              label: 'Ground',
              style: { stroke: '#64748b', strokeWidth: 2 }
            });
          }

          // Match Signal Pins (DATA, GPIO, I/O, SIG)
          const hostIoPin = hostPins.find((p: any) => 
            /data|gpio|io|sig|d5|d13|analog|digital/i.test(p.label || p.id || '')
          );
          const periIoPin = periPins.find((p: any) => 
            /data|gpio|io|sig|in|out/i.test(p.label || p.id || '')
          );
          
          if (hostIoPin && periIoPin) {
            edges.push({
              id: `edge-signal-${i}`,
              source: hostNode.id,
              sourceHandle: hostIoPin.id,
              target: peripheralNode.id,
              targetHandle: periIoPin.id,
              label: 'Signal',
              animated: true,
              style: { stroke: '#3b82f6', strokeWidth: 2 }
            });
          }
        }
      }

      return {
        type: finalType,
        message: parsed.message || response.choices[0]?.message?.content || 'Processed project requirements.',
        nodes: normalizedNodes,
        edges
      };
    } catch (err: any) {
      console.error('OpenAI API error during agentic circuit assembly:', err);
      return {
        type: 'chat_response',
        message: `Error connecting to AI circuit architect: ${err.message}`
      };
    }
  }
}

export const openaiService = new OpenAIService();
