import * as Speech from "expo-speech";

export class TextToSpeechService {
  private isSpeaking: boolean = false;
  private onStartCallbacks: Array<() => void> = [];
  private onFinishCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];
  private initializationPromise: Promise<void>;

  constructor() {
    this.initializationPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const voices = await Speech.getAvailableVoicesAsync();
      console.log("TTS initialized. Available voices:", voices.length);

      const englishVoices = voices.filter((voice) =>
        voice.language?.toLowerCase().startsWith("en"),
      );
      console.log("English TTS voices:", englishVoices.length);
    } catch (e) {
      console.error("TTS initialization error:", e);
    }
  }

  /**
   * Speak text using the Android/iOS native TTS engine.
   */
  async speak(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      // Wait until the native TTS service has finished initializing.
      await this.initializationPromise;

      if (this.isSpeaking) {
        await Speech.stop();
        this.isSpeaking = false;
      }

      console.log("TTS speaking:", trimmed);

      this.isSpeaking = true;
      this.onStartCallbacks.forEach((cb) => cb());

      Speech.speak(trimmed, {
        // Use a complete locale. Android TTS engines are more reliable
        // with en-US than the generic "en" locale.
        language: "en-US",
        pitch: 1.0,
        rate: 0.9,
        onStart: () => {
          console.log("TTS playback started");
        },
        onDone: () => {
          console.log("TTS playback finished");
          this.isSpeaking = false;
          this.onFinishCallbacks.forEach((cb) => cb());
        },
        onStopped: () => {
          console.log("TTS playback stopped");
          this.isSpeaking = false;
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
