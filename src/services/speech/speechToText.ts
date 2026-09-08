/**
 * Speech-to-Text Service
 *
 * For MVP: Uses text input as fallback
 * TODO: Replace with proper Android STT (expo-speech-recognition or similar when available)
 *
 * The proper STT implementation will come from an Expo-compatible library.
 * For now, we use text input to allow testing the full chat flow.
 */

export interface STTModalState {
  visible: boolean;
  onSubmit?: (text: string) => void;
}

export class SpeechToTextService {
  private isListening: boolean = false;
  private onResultsCallbacks: Array<(text: string) => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];
  private onStartCallbacks: Array<() => void> = [];
  private onEndCallbacks: Array<() => void> = [];
  private singleUseResolve: ((text: string) => void) | null = null;
  private modalState: STTModalState = { visible: false };

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    console.log("STT Service initialized (MVP: text input fallback)");
  }

  /**
   * Start listening and wait for result (one-time use)
   * For MVP: This will show a text input modal
   */
  async listenForSpeech(): Promise<string> {
    return new Promise((resolve) => {
      this.singleUseResolve = resolve;
      this.startListening();
    });
  }

  /**
   * Signal to show text input modal
   */
  getModalState(): STTModalState {
    return this.modalState;
  }

  /**
   * Handle text input submission
   */
  handleTextInput(text: string): void {
    if (this.singleUseResolve) {
      this.singleUseResolve(text);
      this.singleUseResolve = null;
    }

    this.onResultsCallbacks.forEach((cb) => cb(text));
    this.stopListening();
  }

  /**
   * Start listening for speech
   */
  async startListening(): Promise<void> {
    try {
      if (this.isListening) return;

      this.isListening = true;
      this.modalState = { visible: true };
      this.onStartCallbacks.forEach((cb) => cb());
    } catch (e) {
      console.error("Failed to start listening:", e);
      this.isListening = false;
      throw e;
    }
  }

  /**
   * Stop listening
   */
  async stopListening(): Promise<void> {
    try {
      if (!this.isListening) return;

      this.isListening = false;
      this.modalState = { visible: false };
      this.onEndCallbacks.forEach((cb) => cb());
    } catch (e) {
      console.error("Failed to stop listening:", e);
      throw e;
    }
  }

  /**
   * Cancel listening
   */
  async cancel(): Promise<void> {
    try {
      this.isListening = false;
      this.modalState = { visible: false };
      this.singleUseResolve = null;
    } catch (e) {
      console.error("Failed to cancel listening:", e);
    }
  }

  /**
   * Register callback for results
   */
  onResults(callback: (text: string) => void): void {
    this.onResultsCallbacks.push(callback);
  }

  /**
   * Register callback for errors
   */
  onError(callback: (error: string) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  /**
   * Register callback for start
   */
  onStart(callback: () => void): void {
    this.onStartCallbacks.push(callback);
  }

  /**
   * Register callback for end
   */
  onEnd(callback: () => void): void {
    this.onEndCallbacks.push(callback);
  }

  /**
   * Check if currently listening
   */
  getIsListening(): boolean {
    return this.isListening;
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    try {
      this.isListening = false;
      this.modalState = { visible: false };
      this.singleUseResolve = null;
      this.onResultsCallbacks = [];
      this.onErrorCallbacks = [];
      this.onStartCallbacks = [];
      this.onEndCallbacks = [];
    } catch (e) {
      console.error("Failed to cleanup STT:", e);
    }
  }
}

let sttInstance: SpeechToTextService | null = null;

export function getSpeechToTextService(): SpeechToTextService {
  if (!sttInstance) {
    sttInstance = new SpeechToTextService();
  }
  return sttInstance;
}
