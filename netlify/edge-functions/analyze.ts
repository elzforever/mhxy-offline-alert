import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";

// Declare Deno globally to avoid TypeScript errors in local development environments
// while ensuring it works in the Netlify Edge (Deno) runtime.
declare var Deno: any;

export default async (request: Request, context: any) => {
  // Handle CORS preflight requests
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // CORRECT WAY for Netlify Edge Functions: Use Deno.env.get
  // process.env will cause a crash (500 Error) in this specific runtime.
  const apiKey = Deno.env.get("GEMINI_API_KEY");

  if (!apiKey) {
    console.error("GEMINI_API_KEY is not configured in Netlify.");
    return new Response(
      JSON.stringify({
        isDisconnected: false,
        confidence: 0,
        reason: "Server Error: GEMINI_API_KEY is missing in Netlify Environment Variables.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const { base64Image } = await request.json();

    if (!base64Image) {
      return new Response(JSON.stringify({ error: "No image data provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    // Extract base64 data
    const dataPart = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

    // Advanced Prompt for Game Disconnection Detection
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

    const response = await ai.models.generateContent({
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
    if (!resultText) throw new Error("No response from Gemini");

    return new Response(resultText, {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Edge Function Error:", error);
    return new Response(
      JSON.stringify({
        isDisconnected: false,
        confidence: 0,
        reason: "Server Analysis Failed: " + error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};