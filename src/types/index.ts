export interface Pin {
  id: string;
  label: string;
  color: string;
}

export interface Diagram {
  theme: string;
  pins: {
    left: Pin[];
    right: Pin[];
  };
}

export interface Component {
  id: string;
  category: string;
  name: string;
  description: string;
  diagram: Diagram;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  components: string[];
  date: string;
  status: 'in-progress' | 'completed';
  canvas: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  };
}

export interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Datasheet {
  id: string;
  name: string;
  size: string;
  parsed: boolean;
  uploadedAt: string;
  filePath: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatRequest {
  message: string;
  projectId?: string;
  history?: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  fallback: boolean;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  affectedComponents: string[];
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidateRequest {
  projectId?: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
