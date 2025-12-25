
import { DetectionResult } from "../types";

export class GeminiService {
  constructor() {
    // No initialization needed as we use the backend proxy
  }

  async analyzeFrame(base64Image: string): Promise<DetectionResult> {
    try {
      // Call the Netlify Edge Function
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ base64Image }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result as DetectionResult;
    } catch (error) {
      console.error("Analysis Request Error:", error);
      return { 
        isDisconnected: false, 
        confidence: 0, 
        reason: "Connection to analysis server failed" 
      };
    }
  }
}
