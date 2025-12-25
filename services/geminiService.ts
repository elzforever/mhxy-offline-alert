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

      // Check for common local dev issues (Vite returns HTML for unknown routes/404s)
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/html")) {
        return {
          isDisconnected: false,
          confidence: 0,
          reason: "API Route Error: Received HTML instead of JSON. Ensure 'netlify.toml' exists and you are running via 'netlify dev' if local."
        };
      }

      if (!response.ok) {
        let errorMsg = `Server error: ${response.status}`;
        try {
            const errData = await response.json();
            if (errData.reason) errorMsg += ` - ${errData.reason}`;
            else if (errData.error) errorMsg += ` - ${errData.error}`;
        } catch (e) {
            // ignore json parse error on error response
        }
        throw new Error(errorMsg);
      }

      const result = await response.json();
      return result as DetectionResult;
    } catch (error: any) {
      console.error("Analysis Request Error:", error);
      return { 
        isDisconnected: false, 
        confidence: 0, 
        reason: "Request Failed: " + (error.message || "Unknown error")
      };
    }
  }
}