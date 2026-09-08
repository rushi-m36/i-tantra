import * as Speech from "expo-speech";

export class TextToSpeechService {
  private isSpeaking: boolean = false;
  private onStartCallbacks: Array<() => void> = [];
  private onFinishCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Check if speech is available
      const voices = await Speech.getAvailableVoicesAsync();
      console.log("Available voices:", voices.length);
    } catch (e) {
      console.error("TTS initialization error:", e);
    }
  }

  /**
   * Speak text
   */
  async speak(text: string): Promise<void> {
    try {
      if (!text) return;

      if (this.isSpeaking) {
        await Speech.stop();
      }

      this.isSpeaking = true;
      this.onStartCallbacks.forEach((cb) => cb());

      await Speech.speak(text, {
        language: "en",
        pitch: 1.0,
        rate: 0.9,
        onDone: () => {
          this.isSpeaking = false;
          this.onFinishCallbacks.forEach((cb) => cb());
        },
        onError: (error: any) => {
          this.isSpeaking = false;
          console.error("TTS Error:", error);
          this.onErrorCallbacks.forEach((cb) =>
            cb(error?.message || "TTS error"),
          );
          this.onFinishCallbacks.forEach((cb) => cb());
        },
      });
    } catch (e) {
      console.error("Failed to speak:", e);
      this.isSpeaking = false;
      throw e;
    }
  }

  /**
   * Stop speaking
   */
  async stop(): Promise<void> {
    try {
      await Speech.stop();
      this.isSpeaking = false;
    } catch (e) {
      console.error("Failed to stop speaking:", e);
    }
  }

  /**
   * Register callback for start
   */
  onStart(callback: () => void): void {
    this.onStartCallbacks.push(callback);
  }

  /**
   * Register callback for finish
   */
  onFinish(callback: () => void): void {
    this.onFinishCallbacks.push(callback);
  }

  /**
   * Register callback for error
   */
  onError(callback: (error: string) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  /**
   * Check if currently speaking
   */
  getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    try {
      await Speech.stop();
      this.isSpeaking = false;
      this.onStartCallbacks = [];
      this.onFinishCallbacks = [];
      this.onErrorCallbacks = [];
    } catch (e) {
      console.error("Failed to cleanup TTS:", e);
    }
  }
}

let ttsInstance: TextToSpeechService | null = null;

export function getTextToSpeechService(): TextToSpeechService {
  if (!ttsInstance) {
    ttsInstance = new TextToSpeechService();
  }
  return ttsInstance;
}
