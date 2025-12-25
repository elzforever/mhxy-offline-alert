import { GoogleGenAI, Type } from "https://esm.sh/@google/genai";

export default async (request: Request, context: any) => {
  // Handle CORS preflight requests if necessary (though usually same-origin on Netlify)
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

  // Retrieve the API Key from environment variables as per guidelines
  // The API key must be obtained exclusively from process.env.API_KEY
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    console.error("API_KEY is not configured.");
    return new Response(
      JSON.stringify({
        isDisconnected: false,
        confidence: 0,
        reason: "Server Configuration Error: API Key missing",
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

    // Initialize Gemini AI with the secure key
    const ai = new GoogleGenAI({ apiKey });

    // Extract the raw base64 data (remove "data:image/jpeg;base64," prefix if present)
    const dataPart = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

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