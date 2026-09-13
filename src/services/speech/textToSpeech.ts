import * as Speech from "expo-speech";
import { Platform } from "react-native";

interface TtsVoice {
  identifier?: string;
  language?: string;
  name?: string;
  networkConnectionRequired?: boolean;
}

export class TextToSpeechService {
  private isSpeaking = false;
  private onStartCallbacks: Array<() => void> = [];
  private onFinishCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];
  private initializationPromise: Promise<void>;
  private voices: TtsVoice[] = [];

  constructor() {
    this.initializationPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      this.voices = (await Speech.getAvailableVoicesAsync()) as TtsVoice[];
    } catch {}
  }

  private getAndroidVoice(): TtsVoice | undefined {
    if (Platform.OS !== "android") return undefined;
    const englishVoices = this.voices.filter((voice) =>
      voice.language?.toLowerCase().startsWith("en"),
    );
    return (
      englishVoices.find((voice) => voice.language?.toLowerCase() === "en-in") ||
      englishVoices.find((voice) => voice.language?.toLowerCase() === "en-us") ||
      englishVoices.find((voice) => voice.networkConnectionRequired === false) ||
      englishVoices[0]
    );
  }

  async speak(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      await this.initializationPromise;
      if (this.isSpeaking) {
        await Speech.stop();
        this.isSpeaking = false;
      }

      const androidVoice = this.getAndroidVoice();
      this.isSpeaking = true;
      this.onStartCallbacks.forEach((cb) => cb());

      const options: Speech.SpeechOptions = {
        pitch: 1.0,
        rate: 0.9,
        onDone: () => {
          this.isSpeaking = false;
          this.onFinishCallbacks.forEach((cb) => cb());
        },
        onStopped: () => {
          this.isSpeaking = false;
        },
        onError: (error: any) => {
          this.isSpeaking = false;
          const message = error?.message || "TTS error";
          this.onErrorCallbacks.forEach((cb) => cb(message));
          this.onFinishCallbacks.forEach((cb) => cb());
        },
      };

      if (androidVoice?.identifier) options.voice = androidVoice.identifier;
      else if (androidVoice?.language) options.language = androidVoice.language;

      Speech.speak(trimmed, options);
    } catch (e) {
      this.isSpeaking = false;
      this.onErrorCallbacks.forEach((cb) => cb(e instanceof Error ? e.message : String(e)));
      throw e;
    }
  }

  async stop(): Promise<void> {
    try {
      await Speech.stop();
      this.isSpeaking = false;
    } catch {}
  }

  onStart(callback: () => void): void { this.onStartCallbacks.push(callback); }
  onFinish(callback: () => void): void { this.onFinishCallbacks.push(callback); }
  onError(callback: (error: string) => void): void { this.onErrorCallbacks.push(callback); }
  getIsSpeaking(): boolean { return this.isSpeaking; }

  async cleanup(): Promise<void> {
    try {
      await Speech.stop();
      this.isSpeaking = false;
      this.onStartCallbacks = [];
      this.onFinishCallbacks = [];
      this.onErrorCallbacks = [];
    } catch {}
  }
}

let ttsInstance: TextToSpeechService | null = null;

export function getTextToSpeechService(): TextToSpeechService {
  if (!ttsInstance) ttsInstance = new TextToSpeechService();
  return ttsInstance;
}
