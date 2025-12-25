
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
}

export interface Settings {
  webhookUrl: string;
  meowCode: string; // Changed from pushPlusToken to meowCode
  checkInterval: number; // seconds
  sensitivity: number;
}
