import { Schema, model, type Document, type Types } from 'mongoose';

const PinSchema = new Schema(
  { id: String, label: String, color: String },
  { _id: false },
);

const DiagramSchema = new Schema(
  {
    theme: String,
    pins: {
      left: { type: [PinSchema], default: [] },
      right: { type: [PinSchema], default: [] },
    },
  },
  { _id: false },
);

export interface IComponent extends Document {
  userId: Types.ObjectId;
  datasheetId: Types.ObjectId | null;
  category: string;
  name: string;
  description: string;
  diagram: {
    theme: string;
    pins: {
      left: Array<{ id: string; label: string; color: string }>;
      right: Array<{ id: string; label: string; color: string }>;
    };
  };
  cogneeConfig: Record<string, unknown> | null;
}

const ComponentSchema = new Schema<IComponent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    datasheetId: {
      type: Schema.Types.ObjectId,
      ref: 'Datasheet',
      default: null,
    },
    category: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    diagram: { type: DiagramSchema, required: true },
    cogneeConfig: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const Component = model<IComponent>('Component', ComponentSchema);
