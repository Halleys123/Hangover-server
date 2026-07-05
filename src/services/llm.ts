import type {
  ChatMessage,
  ValidationResult,
  CanvasNode,
  CanvasEdge,
  ValidationIssue,
} from '../types/index.js';
import { openaiService } from './openaiService.js';
import { Component } from '../models/Component.js';
import { logger } from '../utils/logger.js';

/**
 * Generate an AI chat response using the configured OpenAI-compatible provider.
 */
export async function generateChatResponse(
  message: string,
  history: ChatMessage[],
  componentContext: string,
): Promise<string> {
  return await openaiService.generateChatResponse(message, { componentContext, history });
}

interface ExtractedPinDetails {
  id: string;
  name: string;
  type: 'power' | 'ground' | 'digital' | 'analog' | 'passive';
  voltage: number;
  maxTolerance: number;
}

/**
 * Helper to search and guess technical characteristics for a specific pin of a component.
 */
function findPinDetails(comp: any, pinId: string): ExtractedPinDetails {
  const pinIdClean = (pinId || '').trim();
  const pinIdLower = pinIdClean.toLowerCase();

  // Initialize defaults
  let type: 'power' | 'ground' | 'digital' | 'analog' | 'passive' = 'digital';
  let voltage = 3.3;
  let maxTolerance = 3.6;

  // Guess defaults based on pin ID keywords
  const isGnd = pinIdLower.includes('gnd') || pinIdLower.includes('ground') || pinIdLower.includes('cathode') || pinIdLower.includes('g_n_d');
  const isPower = pinIdLower.includes('vcc') || pinIdLower.includes('5v') || pinIdLower.includes('3v3') || pinIdLower.includes('3.3v') || pinIdLower.includes('vin') || pinIdLower.includes('anode') || pinIdLower.includes('+v') || pinIdLower.includes('power');
  const isAnalog = pinIdLower.includes('adc') || pinIdLower.includes('analog') || (pinIdLower.startsWith('a') && !isNaN(Number(pinIdLower.slice(1))));

  if (isGnd) {
    type = 'ground';
    voltage = 0.0;
    maxTolerance = 0.3;
  } else if (isPower) {
    type = 'power';
    voltage = pinIdLower.includes('5v') || pinIdLower.includes('vin') ? 5.0 : 3.3;
    maxTolerance = voltage + 0.3;
  } else if (isAnalog) {
    type = 'analog';
  }

  // If component has cogneeConfig (extracted specifications), look up details
  if (comp?.cogneeConfig?.Pins && typeof comp.cogneeConfig.Pins === 'object') {
    const pinsObj = comp.cogneeConfig.Pins;
    let foundPin: any = null;

    // Search in all categories (power, ground, digital, analog, others)
    for (const key of Object.keys(pinsObj)) {
      if (Array.isArray(pinsObj[key])) {
        const match = pinsObj[key].find((p: any) => {
          if (!p?.id) return false;
          const pIdLower = String(p.id).toLowerCase();
          const pNameLower = String(p.name || '').toLowerCase();
          return pIdLower === pinIdLower || pNameLower === pinIdLower || 
                 pIdLower.replace(/[^a-z0-9]/g, '') === pinIdLower.replace(/[^a-z0-9]/g, '');
        });
        if (match) {
          foundPin = match;
          break;
        }
      }
    }

    if (foundPin) {
      const pinTypeStr = String(foundPin.type || '').toLowerCase();
      if (pinTypeStr.includes('ground') || pinTypeStr.includes('gnd')) {
        type = 'ground';
        voltage = 0.0;
        maxTolerance = 0.3;
      } else if (pinTypeStr.includes('power') || pinTypeStr.includes('pwr')) {
        type = 'power';
        voltage = Number(foundPin.voltage) || (pinIdLower.includes('5v') ? 5.0 : 3.3);
        maxTolerance = voltage + 0.3;
      } else if (pinTypeStr.includes('analog') || pinTypeStr.includes('adc')) {
        type = 'analog';
        voltage = Number(foundPin.outputVoltage) || 3.3;
        maxTolerance = Number(foundPin.maxVoltageTolerance) || voltage + 0.3;
      } else {
        type = 'digital';
        voltage = Number(foundPin.outputVoltage) || 3.3;
        maxTolerance = Number(foundPin.maxVoltageTolerance) || voltage + 0.3;
      }
    }
  }

  return {
    id: pinIdClean,
    name: pinIdClean,
    type,
    voltage,
    maxTolerance,
  };
}

/**
 * Validate circuit nodes and edges using a deterministic JavaScript graph safety validation engine.
 */
export async function validateCircuit(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): Promise<ValidationResult> {
  logger.info(`[Validation] Running deterministic safety checks on ${nodes.length} nodes and ${edges.length} edges...`);
  const issues: ValidationIssue[] = [];

  try {
    // 1. Fetch specifications for all components present on the canvas
    const componentSpecsMap = new Map<string, any>();
    for (const node of nodes) {
      const label = node.data?.label;
      if (typeof label === 'string' && label) {
        let comp = await Component.findOne({ name: label });
        if (!comp) {
          comp = await Component.findOne({ name: { $regex: new RegExp('^' + label + '$', 'i') } });
        }
        if (comp) {
          componentSpecsMap.set(node.id, comp);
        }
      }
    }

    // 2. Map nodes by ID for fast lookup
    const nodeMap = new Map<string, CanvasNode>();
    nodes.forEach(n => nodeMap.set(n.id, n));

    // 3. Process each connection wire (edge)
    for (const edge of edges) {
      const srcNode = nodeMap.get(edge.source);
      const tgtNode = nodeMap.get(edge.target);
      if (!srcNode || !tgtNode) continue;

      const srcComp = componentSpecsMap.get(edge.source);
      const tgtComp = componentSpecsMap.get(edge.target);

      // Extract pin details using handle values
      const srcPin = findPinDetails(srcComp, edge.sourceHandle || '');
      const tgtPin = findPinDetails(tgtComp, edge.targetHandle || '');

      const srcCompName = String(srcNode.data?.label || 'Source Component');
      const tgtCompName = String(tgtNode.data?.label || 'Target Component');

      // Rule A: Short Circuit Check (Direct power rail connection to GND)
      if (
        (srcPin.type === 'power' && tgtPin.type === 'ground') ||
        (srcPin.type === 'ground' && tgtPin.type === 'power')
      ) {
        issues.push({
          severity: 'error',
          message: `Direct Short Circuit Hazard: Connected power lead '${srcPin.id}' directly to ground lead '${tgtPin.id}' between '${srcCompName}' and '${tgtCompName}'. This will short your power supply.`,
          affectedComponents: [edge.source, edge.target],
        });
        continue;
      }

      // Rule B: Voltage Rail Conflict Check
      if (srcPin.type === 'power' && tgtPin.type === 'power' && Math.abs(srcPin.voltage - tgtPin.voltage) > 0.2) {
        issues.push({
          severity: 'error',
          message: `Voltage Rail Conflict: Connecting two active power sources of different levels directly (${srcPin.voltage}V on '${srcCompName}' to ${tgtPin.voltage}V on '${tgtCompName}'). This will damage power regulators.`,
          affectedComponents: [edge.source, edge.target],
        });
        continue;
      }

      // Rule C: Overvoltage Limit Check (Source voltage exceeds target pin's tolerance)
      if (srcPin.type !== 'ground' && tgtPin.type !== 'ground') {
        const srcV = srcPin.voltage;
        const tgtMax = tgtPin.maxTolerance;
        if (srcV > tgtMax && Math.abs(srcV - tgtMax) > 0.2) {
          issues.push({
            severity: 'error',
            message: `Overvoltage Risk: '${srcCompName}' pin '${srcPin.id}' outputs ${srcV}V, which exceeds the absolute maximum input tolerance (${tgtMax}V) of '${tgtCompName}' pin '${tgtPin.id}'. Connecting them directly will burn the pin. Use a logic level shifter.`,
            affectedComponents: [edge.source, edge.target],
          });
          continue;
        }
      }

      // Rule D: High-Current Direct Sourcing Check
      // If a microcontroller GPIO pin connects directly to a high-current load pin (like a Peltier cooler or motor VCC lead)
      const isMcuSource = srcCompName.toLowerCase().includes('arduino') || srcCompName.toLowerCase().includes('esp32') || srcCompName.toLowerCase().includes('uno') || srcCompName.toLowerCase().includes('nodemcu');
      const isHighCurrentTarget = tgtCompName.toLowerCase().includes('peltier') || tgtCompName.toLowerCase().includes('tec1') || tgtCompName.toLowerCase().includes('cooler') || tgtCompName.toLowerCase().includes('fan') || tgtCompName.toLowerCase().includes('motor') || tgtCompName.toLowerCase().includes('pump');
      
      if (isMcuSource && isHighCurrentTarget && tgtPin.type === 'power') {
        // Retrieve target specs current draw if available
        let currentDraw = 500; // default assumption for motor/fans
        if (tgtComp?.cogneeConfig?.['Electrical Limits']?.maxCurrentmA) {
          currentDraw = Number(tgtComp.cogneeConfig['Electrical Limits'].maxCurrentmA);
        } else if (tgtCompName.toLowerCase().includes('peltier') || tgtCompName.toLowerCase().includes('tec1')) {
          currentDraw = 6000; // Peltier cooler draw
        }

        if (currentDraw > 100) {
          issues.push({
            severity: 'warning',
            message: `Current Overload Risk: You are connecting high-power component '${tgtCompName}' (pulls up to ${currentDraw}mA) directly to logic pin '${srcPin.id}' on microcontroller '${srcCompName}'. Microcontroller outputs are limited to ~20mA. You must drive '${tgtCompName}' using a MOSFET transistor, relay, or motor driver.`,
            affectedComponents: [edge.source, edge.target],
          });
        }
      }
    }
  } catch (err: any) {
    logger.error('[Validation] Deterministic validator failed:', err.message || err);
    issues.push({
      severity: 'warning',
      message: `Safety validation engine encountered an issue during analysis: ${err.message || 'Unknown error'}.`,
      affectedComponents: [],
    });
  }

  const valid = !issues.some(issue => issue.severity === 'error');
  logger.info(`[Validation] Completed. Status: ${valid ? 'SAFE' : 'HAZARDS DETECTED'}. Total issues found: ${issues.length}`);

  return {
    valid,
    issues,
  };
}
