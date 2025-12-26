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
    /server\s?error/i,
    /timed\s?out/i,
    
    // --- Other Chinese Contexts ---
    /断开连接/,       // Disconnected
    /连接超时/,       // Connection Timeout
    /网络异常/,       // Network Exception
    /与服务器断开/,    // Disconnected from server
    /点击重试/,       // Click to retry
    /确定/            // Confirm (Context dependant, but useful if combined with others, though here we match single phrases)
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

  /**
   * Preprocesses the image to improve OCR accuracy.
   * 1. Crops to the center (where dialogs usually are).
   * 2. Converts to Grayscale.
   * 3. Binarizes (High contrast black/white).
   */
  private async preprocessImage(base64Image: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(base64Image); // Fallback
          return;
        }

        // 1. CROP: Focus on the center 70% width and 60% height.
        // This removes chat windows (bottom left), minimaps (top right), and status bars.
        const cropWidth = img.width * 0.7;
        const cropHeight = img.height * 0.6;
        const startX = (img.width - cropWidth) / 2;
        const startY = (img.height - cropHeight) / 2;

        canvas.width = cropWidth;
        canvas.height = cropHeight;

        // Draw the cropped area onto the canvas
        ctx.drawImage(img, startX, startY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

        // 2. GRAYSCALE & BINARIZATION
        const imageData = ctx.getImageData(0, 0, cropWidth, cropHeight);
        const data = imageData.data;
        
        // Threshold for binarization (0-255). 
        // 128 is standard, but sometimes game dialogs are semi-transparent dark.
        // We use a dynamic approach or a fixed safe value. 
        // For game text (usually white on dark or black on white), high contrast is key.
        const threshold = 160; 

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Standard luminosity formula
          const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

          // Binarize: If lighter than threshold, make it white, else black.
          // This creates a sharp black/white image which Tesseract loves.
          const val = gray >= threshold ? 255 : 0;

          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
          // data[i+3] is alpha, leave it alone
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = reject;
      img.src = base64Image;
    });
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
      // Step 1: Preprocess the image (Crop + Binarize)
      const processedImage = await this.preprocessImage(base64Image);

      // Step 2: Analyze the PROCESSED image
      const { data: { text, confidence } } = await this.worker.recognize(processedImage);
      
      // Strategy: Remove ALL whitespace to handle Tesseract's tendency to add spaces 
      const denseText = text.replace(/\s+/g, '');
      const readableText = text.replace(/\s+/g, ' ').trim();
      
      // Check for keywords against the dense text
      const matchedKeyword = this.errorKeywords.find(regex => regex.test(denseText));

      if (matchedKeyword) {
        const matchString = denseText.match(matchedKeyword)?.[0] || "Error Keyword";
        
        return {
          isDisconnected: true,
          confidence: Math.max(0.85, confidence / 100), 
          reason: `Detected: "${matchString}"`,
          debugText: `[Match Found]\nProcessed: "${denseText}"`,
          processedImage: processedImage // Return the b&w image for debugging
        };
      }

      return {
        isDisconnected: false,
        confidence: 0,
        reason: "No error text detected",
        debugText: `[No Match]\nProcessed: "${denseText}"`,
        processedImage: processedImage
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