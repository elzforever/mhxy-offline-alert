
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
  pushPlusToken: string; // Added for WeChat notifications
  checkInterval: number; // seconds
  sensitivity: number;
}
