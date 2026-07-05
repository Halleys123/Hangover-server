import { Schema, model, type Document } from 'mongoose';

export interface IPinConstraint {
  pinNumber: string | number;
  pinName: string;
  outputVoltage: number;
  maxInputTolerance: number;
  pinType?: 'power' | 'ground' | 'digital_out' | 'digital_in' | 'analog' | 'bidirectional';
  description?: string;
}

export interface IComponentGraphNode extends Document {
  dataset: string;
  componentName: string;
  description?: string;
  operatingVoltageRange?: { min: number; max: number };
  maxCurrentDrawmA?: number;
  pins: Record<string, IPinConstraint>;
  rawText?: string;
  updatedAt: Date;
}

const ComponentGraphNodeSchema = new Schema<IComponentGraphNode>(
  {
    dataset: { type: String, required: true },
    componentName: { type: String, required: true },
    description: { type: String, default: '' },
    operatingVoltageRange: {
      min: { type: Number, default: 3.0 },
      max: { type: Number, default: 3.6 },
    },
    maxCurrentDrawmA: { type: Number, default: 50 },
    pins: { type: Schema.Types.Mixed, default: {} },
    rawText: { type: String, default: '' },
  },
  { timestamps: true }
);

// Unique compound index so lookups are extremely fast and no duplicates are created
ComponentGraphNodeSchema.index({ dataset: 1, componentName: 1 }, { unique: true });

export const ComponentGraphNode = model<IComponentGraphNode>(
  'ComponentGraphNode',
  ComponentGraphNodeSchema
);
