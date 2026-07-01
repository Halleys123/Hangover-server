import { Router } from 'express';
import { validateCircuit } from '../services/llm.js';
import type { ValidateRequest, ValidationResult } from '../types/index.js';

const router = Router();

router.post('/', async (req, res, next) => {
  const { nodes, edges } = req.body as ValidateRequest;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return res
      .status(400)
      .json({ error: 'nodes and edges arrays are required' });
  }

  // Attempt LLM-based validation
  try {
    const result = await validateCircuit(nodes, edges);
    return res.json(result);
  } catch (err: any) {
    if (err.message === 'LLM_NOT_CONFIGURED') {
      // Fallback: perform basic rule-based checks without LLM
      const result = runBasicValidation(nodes, edges);
      return res.json(result);
    }
    next(err);
  }
});

/**
 * Rule-based fallback validation that runs without LLM.
 * Detects obvious voltage mismatches based on component metadata.
 *
 * TODO: Expand these rules or replace entirely with LLM validation.
 */
function runBasicValidation(nodes: any[], edges: any[]): ValidationResult {
  const issues: ValidationResult['issues'] = [];

  const voltageMap: Record<string, number> = {};
  for (const node of nodes) {
    const label: string = node.data?.label ?? '';
    if (
      label.toLowerCase().includes('esp32') ||
      label.toLowerCase().includes('3.3v')
    ) {
      voltageMap[node.id] = 3.3;
    } else if (
      label.toLowerCase().includes('arduino') ||
      label.toLowerCase().includes('uno')
    ) {
      voltageMap[node.id] = 5.0;
    }
  }

  for (const edge of edges) {
    const srcV = voltageMap[edge.source];
    const tgtV = voltageMap[edge.target];
    if (srcV !== undefined && tgtV !== undefined && srcV !== tgtV) {
      issues.push({
        severity: 'error',
        message: `Voltage mismatch: ${srcV}V component connected to ${tgtV}V component. Use a level shifter.`,
        affectedComponents: [edge.source, edge.target],
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export default router;
