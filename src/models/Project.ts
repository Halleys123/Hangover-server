import { Schema, model, type Document, Types } from 'mongoose';

const NodeSchema = new Schema(
  {
    id: String,
    type: String,
    position: { x: Number, y: Number },
    data: Schema.Types.Mixed,
  },
  { _id: false },
);

const EdgeSchema = new Schema(
  {
    id: String,
    source: String,
    target: String,
    sourceHandle: String,
    targetHandle: String,
  },
  { _id: false },
);

export interface IProject extends Document {
  userId: Types.ObjectId;
  name: string;
  description: string;
  status: 'in-progress' | 'completed';
  date: string;
  components: string[];
  datasheets: Types.ObjectId[];
  canvas: {
    nodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      sourceHandle?: string;
      targetHandle?: string;
    }>;
  };
  chatHistory: Array<{
    _id: Types.ObjectId;
    title: string;
    chats: Array<{
      role: 'user' | 'assistant';
      text: string;
      timestamp: Date;
    }>;
  }>;
}

const ProjectSchema = new Schema<IProject>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    status: {
      type: String,
      enum: ['in-progress', 'completed'],
      default: 'in-progress',
    },
    date: { type: String, required: true },
    components: { type: [String], default: [] },
    datasheets: [{ type: Schema.Types.ObjectId, ref: 'Datasheet' }],
    canvas: {
      nodes: { type: [NodeSchema], default: [] },
      edges: { type: [EdgeSchema], default: [] },
    },
    chatHistory: {
      type: [
        {
          _id: { type: Schema.Types.ObjectId, default: () => new Types.ObjectId() },
          title: { type: String, required: true },
          chats: [
            {
              role: { type: String, enum: ['user', 'assistant'], required: true },
              text: { type: String, required: true },
              timestamp: { type: Date, default: Date.now },
            }
          ]
        }
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const Project = model<IProject>('Project', ProjectSchema);
