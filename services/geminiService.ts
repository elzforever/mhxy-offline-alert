
import { GoogleGenAI, Type } from "@google/genai";
import { DetectionResult } from "../types";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async analyzeFrame(base64Image: string): Promise<DetectionResult> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64Image.split(',')[1],
                },
              },
              {
                text: "Analyze this game screenshot. Check specifically for 'Network Error' dialogs. Look for the Chinese text '网络错误' (Network Error), '请重新登录' (Please log in again), '网络有问题' (Network problem), or English equivalents like 'Connection Lost', 'Disconnected'. If ANY of these exist, set isDisconnected to true. Respond in JSON format only.",
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
                description: "Confidence score from 0 to 1.",
              },
              reason: {
                type: Type.STRING,
                description: "Description of the text found (e.g. 'Found Chinese Network Error dialog').",
              },
            },
            required: ["isDisconnected", "confidence", "reason"],
          },
        },
      });

      const resultText = response.text;
      if (!resultText) throw new Error("No response from Gemini");
      return JSON.parse(resultText) as DetectionResult;
    } catch (error) {
      console.error("Gemini Analysis Error:", error);
      return { isDisconnected: false, confidence: 0, reason: "Error during analysis" };
    }
  }
}
