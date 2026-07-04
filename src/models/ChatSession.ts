import { Schema, model, type Document, type Types } from 'mongoose';

export interface IChatSession extends Document {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  messages: Array<{
    role: 'user' | 'assistant';
    text: string;
    timestamp: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const ChatSessionSchema = new Schema<IChatSession>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    messages: {
      type: [
        {
          role: { type: String, enum: ['user', 'assistant'], required: true },
          text: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export const ChatSession = model<IChatSession>('ChatSession', ChatSessionSchema);
