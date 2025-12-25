import { createWorker, Worker } from 'tesseract.js';
import { DetectionResult } from "../types";

export class OcrService {
  private worker: Worker | null = null;
  private isInitializing: boolean = false;
  private initError: string | null = null;

  // Keywords refined based on user feedback.
  // Priority: 1. 网络错误 (Network Error) 2. 请重新登录 (Please Relogin)
  // NOTE: Text is stripped of whitespace before matching, so English keywords use \s? to match "NetworkError"
  private errorKeywords = [
    // --- Top Priority (Core Disconnect Indicators) ---
    /网络错误/,       // Network Error (Most accurate)
    /请重新登录/,     // Please Relogin (Secondary accurate)
    /请重新连接/,     // Please Reconnect (Common variant)

    // --- English Strong Indicators ---
    /network\s?error/i,
    /connection\s?lost/i,
    /disconnected/i,
    /please\s?relogin/i,
    /please\s?reconnect/i,
    
    // --- Other Chinese Contexts ---
    /断开连接/,       // Disconnected
    /连接超时/,       // Connection Timeout
    /网络异常/,       // Network Exception
    /与服务器断开/     // Disconnected from server
  ];

  constructor() {
    this.init();
  }

  private async init() {
    if (this.isInitializing || this.worker) return;
    this.isInitializing = true;

    try {
      console.log("Initializing Tesseract Worker...");
      // Using 'chi_sim' (Simplified Chinese) and 'eng' (English)
      const worker = await createWorker('eng+chi_sim'); 
      this.worker = worker;
      console.log("Tesseract Worker Ready");
    } catch (e: any) {
      console.error("Tesseract Init Failed:", e);
      this.initError = "OCR Model Load Failed: " + e.message;
    } finally {
      this.isInitializing = false;
    }
  }

  async analyzeFrame(base64Image: string): Promise<DetectionResult> {
    if (this.initError) {
      return {
        isDisconnected: false,
        confidence: 0,
        reason: "OCR Init Error: " + this.initError
      };
    }

    if (!this.worker) {
      this.init(); 
      return {
        isDisconnected: false,
        confidence: 0,
        reason: "OCR Model Loading..."
      };
    }

    try {
      // Analyze the image
      const { data: { text, confidence } } = await this.worker.recognize(base64Image);
      
      // Strategy: Remove ALL whitespace to handle Tesseract's tendency to add spaces 
      // between Chinese characters (e.g., "网 络 错 误") and to handle English lines safely.
      // Existing English regexes use \s? so they support "NetworkError" (no space).
      const denseText = text.replace(/\s+/g, '');
      
      // For debugging visibility, we also keep a readable version
      const readableText = text.replace(/\s+/g, ' ').trim();
      
      // Check for keywords against the dense text
      const matchedKeyword = this.errorKeywords.find(regex => regex.test(denseText));

      if (matchedKeyword) {
        // Extract the actual string that matched to show the user
        const matchString = denseText.match(matchedKeyword)?.[0] || "Error Keyword";
        
        return {
          isDisconnected: true,
          // High confidence if we match these specific keywords
          confidence: Math.max(0.85, confidence / 100), 
          reason: `Detected: "${matchString}"`,
          debugText: `[Match Found]\nProcessed: "${denseText}"\nOriginal: "${readableText}"`
        };
      }

      return {
        isDisconnected: false,
        confidence: 0,
        reason: "No error text detected",
        debugText: `[No Match]\nProcessed: "${denseText}"\nOriginal: "${readableText}"`
      };

    } catch (error: any) {
      console.error("OCR Analysis Error:", error);
      return { 
        isDisconnected: false, 
        confidence: 0, 
        reason: "OCR Failed: " + (error.message || "Unknown error")
      };
    }
  }
  
  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}