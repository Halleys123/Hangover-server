import type { Request, Response, NextFunction } from 'express';
import { validateCircuit } from '../services/llm.js';
import type { ValidateRequest, ValidationResult } from '../types/index.js';

export class ValidationController {
  private runBasicValidation(nodes: any[], edges: any[]): ValidationResult {
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

  public async validate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { nodes, edges } = req.body as ValidateRequest;

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      res.status(400).json({ error: 'nodes and edges arrays are required' });
      return;
    }

    try {
      const result = await validateCircuit(nodes, edges);
      res.json(result);
    } catch (err: any) {
      if (err.message === 'LLM_NOT_CONFIGURED') {
        const result = this.runBasicValidation(nodes, edges);
        res.json(result);
        return;
      }
      next(err);
    }
  }
}

export const validationController = new ValidationController();
