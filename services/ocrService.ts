import { createWorker, Worker } from 'tesseract.js';
import { DetectionResult } from "../types";

export class OcrService {
  private worker: Worker | null = null;
  private isInitializing: boolean = false;
  private initError: string | null = null;

  // Keywords refined based on user feedback and screenshots.
  // We will strip all punctuation and spaces before matching, so keywords should be pure text.
  private errorKeywords = [
    // --- From User Screenshot ---
    /网络错误/,       // Matches title and body
    /请重新登录/,     // Matches body
    /网络有问题/,     // Matches the blue link text
    /检测一下吧/,     // Matches the blue link text
    
    // --- Common Disconnect Indicators ---
    /请重新连接/,
    /断开连接/,
    /连接超时/,
    /网络异常/,
    /服务器断开/,
    /点击重试/,
    
    // --- English ---
    /networkerror/i,
    /connectionlost/i,
    /disconnected/i,
    /pleaserelogin/i,
    /servererror/i,
    /timedout/i
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
   * 2. UPSCALES by 2x (Critical for small text).
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
        // This removes chat windows, minimaps, etc.
        const cropWidth = img.width * 0.7;
        const cropHeight = img.height * 0.6;
        const startX = (img.width - cropWidth) / 2;
        const startY = (img.height - cropHeight) / 2;

        // 2. UPSCALE: Scale up by 2x. Tesseract loves larger text.
        // If the text in the game is 12px, OCR might fail. At 24px, it works great.
        const scaleFactor = 2.0;
        
        canvas.width = cropWidth * scaleFactor;
        canvas.height = cropHeight * scaleFactor;

        // Draw the cropped area onto the canvas, scaled up
        ctx.drawImage(
          img, 
          startX, startY, cropWidth, cropHeight, // Source rect
          0, 0, canvas.width, canvas.height      // Dest rect (Scaled)
        );

        // 3. GRAYSCALE & BINARIZATION
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Threshold for binarization (0-255). 
        // 160 works well for standard UI (Dark text on Light background).
        const threshold = 160; 

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          
          // Standard luminosity formula
          const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

          // Binarize:
          // If the pixel is light (background), make it pure WHITE (255).
          // If the pixel is dark (text), make it pure BLACK (0).
          const val = gray >= threshold ? 255 : 0;

          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
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
      // Step 1: Preprocess the image (Crop + Upscale + Binarize)
      const processedImage = await this.preprocessImage(base64Image);

      // Step 2: Analyze the PROCESSED image
      const { data: { text, confidence } } = await this.worker.recognize(processedImage);
      
      // Step 3: Normalization Strategy
      // Instead of just removing spaces, we remove ALL punctuation and symbols.
      // Example: "网络错误，请重新登录。" -> "网络错误请重新登录"
      // This prevents OCR errors where a comma is read as a dot or a speck of dust.
      const cleanText = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
      
      // Check for keywords against the cleaned text
      const matchedKeyword = this.errorKeywords.find(regex => regex.test(cleanText));

      if (matchedKeyword) {
        const matchString = cleanText.match(matchedKeyword)?.[0] || "Error Keyword";
        
        return {
          isDisconnected: true,
          confidence: Math.max(0.85, confidence / 100), 
          reason: `Detected: "${matchString}"`,
          debugText: `[Match Found]\nRaw: "${text.substring(0, 20)}..."\nClean: "${cleanText}"`,
          processedImage: processedImage 
        };
      }

      return {
        isDisconnected: false,
        confidence: 0,
        reason: "No error text detected",
        debugText: `[No Match]\nClean: "${cleanText}"`,
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