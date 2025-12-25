import { GoogleGenAI, Type } from "@google/genai";
import { DetectionResult } from "../types";

export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private initError: string | null = null;

  constructor() {
    // Initialize Gemini API Client directly in the browser.
    // NOTE: For local development, ensure your bundler (Vite/Webpack) exposes process.env.API_KEY.
    const apiKey = process.env.API_KEY;

    if (!apiKey) {
      this.initError = "API Key Missing: process.env.API_KEY is not set. Please check your local .env file.";
      console.error(this.initError);
    } else {
      try {
        this.ai = new GoogleGenAI({ apiKey });
      } catch (e: any) {
        this.initError = "Gemini Client Init Failed: " + e.message;
        console.error(this.initError);
      }
    }
  }

  async analyzeFrame(base64Image: string): Promise<DetectionResult> {
    // Fail fast if initialization failed
    if (this.initError || !this.ai) {
      return {
        isDisconnected: false,
        confidence: 0,
        reason: "Configuration Error: " + (this.initError || "Gemini Client not initialized")
      };
    }

    try {
      // Extract base64 data (remove "data:image/jpeg;base64," prefix if present)
      const dataPart = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

      const promptText = `
      Act as a game stability monitor. Analyze this screenshot to detect if the user has been disconnected or if the game is in an error state.

      Look for these indicators (High Priority):
      1. **Explicit Keywords**: "Network Error", "Connection Lost", "Disconnected", "Reconnecting", "Server Error", "Timed Out", "Login Failed", "Unexpected error", "Finish what you were doing".
      2. **Chinese Keywords**: "网络错误", "请重新登录", "断开连接", "连接超时", "网络异常", "服务器断开", "系统提示", "重试".
      3. **Buttons**: A dialog box with a single or dual button layout containing text like "Confirm", "Retry", "Ok", "Reconnect", "Login", "确定", "重试", "重新连接".

      Look for these indicators (Implicit/Visual):
      4. **Modal Overlay**: A centered alert box/dialog that darkens the background and clearly interrupts gameplay.
      5. **Empty State**: A black screen with a spinning loader that has persisted (implies stuck).

      **Decision Logic**:
      - If you see a "Network Error", "Unexpected error", or "Disconnected" text -> isDisconnected: true (High Confidence).
      - If you see a generic popup with "Retry" or "Confirm" in the center of the screen that looks like an error -> isDisconnected: true (Medium Confidence).
      - If the game looks normal (HUD visible, character visible, no obstructing popups) -> isDisconnected: false.

      Return a JSON object with:
      - isDisconnected: boolean
      - confidence: number (0.0 to 1.0)
      - reason: string (Short explanation, e.g., "Found dialog box with text 'Connection Lost'")
    `;

      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: dataPart,
                },
              },
              {
                text: promptText,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isDisconnected: {
                type: Type.BOOLEAN,
                description: "True if a disconnection or network error popup is detected.",
              },
              confidence: {
                type: Type.NUMBER,
                description: "Confidence score from 0.0 to 1.0.",
              },
              reason: {
                type: Type.STRING,
                description: "Brief description of the detected error text or dialog.",
              },
            },
            required: ["isDisconnected", "confidence", "reason"],
          },
        },
      });

      const resultText = response.text;
      if (!resultText) throw new Error("No response text from Gemini");

      // Attempt to parse JSON
      try {
          const result = JSON.parse(resultText) as DetectionResult;
          return result;
      } catch (e) {
          // Sometimes models output markdown code blocks even with MIME type set, handle that gracefully
          const cleanJson = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
          return JSON.parse(cleanJson) as DetectionResult;
      }

    } catch (error: any) {
      console.error("Gemini Local Analysis Error:", error);
      return { 
        isDisconnected: false, 
        confidence: 0, 
        reason: "Analysis Failed: " + (error.message || "Unknown error")
      };
    }
  }
}