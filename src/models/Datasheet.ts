import { Schema, model, type Document, type Types } from 'mongoose';

export interface IDatasheet extends Document {
  userId: Types.ObjectId;
  name: string;
  size: string;
  filePath: string;
  parsed: boolean;
  cogneeConfig: Record<string, unknown> | null;
  uploadedAt: Date;
}

const DatasheetSchema = new Schema<IDatasheet>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    size: { type: String, required: true },
    filePath: { type: String, default: '' },
    parsed: { type: Boolean, default: false },
    cogneeConfig: { type: Schema.Types.Mixed, default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const Datasheet = model<IDatasheet>('Datasheet', DatasheetSchema);
