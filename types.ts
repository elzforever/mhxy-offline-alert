
export interface MonitorState {
  isMonitoring: boolean;
  status: 'idle' | 'scanning' | 'alert' | 'offline';
  lastCheck: Date | null;
  logs: MonitorLog[];
}

export interface MonitorLog {
  id: string;
  timestamp: Date;
  type: 'info' | 'error' | 'success' | 'warning';
  message: string;
  imageUrl?: string;
}

export interface DetectionResult {
  isDisconnected: boolean;
  confidence: number;
  reason: string;
  debugText?: string; // Raw text extracted by OCR for debugging
  processedImage?: string; // The image after grayscale/cropping processing
}

export interface Settings {
  webhookUrl: string;
  meowCode: string; // Changed from pushPlusToken to meowCode
  checkInterval: number; // seconds
  sensitivity: number;
  enableLocalSound: boolean; // New: Local TTS alert
}