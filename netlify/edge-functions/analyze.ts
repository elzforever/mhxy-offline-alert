import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";

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

  try {
    const { base64Image } = await request.json();

    if (!base64Image) {
      return new Response(JSON.stringify({ error: "No image data provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Use process.env.API_KEY directly as per @google/genai guidelines.
    // Ensure process.env.API_KEY is available in your environment configuration.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Extract base64 data
    const dataPart = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

    // Improved Prompt for better detection
    const promptText = `
      Analyze this game screenshot for network connection issues.
      
      Detect ANY of the following:
      1. Explicit Error Text: "Network Error", "Connection Lost", "Disconnected", "Reconnecting", "Server Error", "Timed Out".
      2. Chinese Text: "网络错误", "请重新登录", "断开连接", "连接超时", "网络异常", "服务器断开".
      3. Implicit UI Signs: A center pop-up modal/dialog box that interrupts gameplay, containing buttons like "Retry", "Reconnect", "Confirm", "Login", or "Ok".
      
      If ANY of these signs are present, set isDisconnected to true.
      Provide a confidence score (0-1) and a short reason describing what was found.
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
        reason: "Analysis Failed: " + error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};