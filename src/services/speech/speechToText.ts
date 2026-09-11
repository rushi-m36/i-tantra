import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { Platform } from "react-native";

type EventSubscription = { remove: () => void };

export interface STTModalState {
  visible: boolean;
  onSubmit?: (text: string) => void;
}

const DEFAULT_LOCALE = "en-US";
const ANDROID_ON_DEVICE_SERVICE = "com.google.android.as";

export class SpeechToTextService {
  private isListening = false;
  private onResultsCallbacks: Array<(text: string) => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];
  private onStartCallbacks: Array<() => void> = [];
  private onEndCallbacks: Array<() => void> = [];
  private resultSubscription: EventSubscription | null = null;
  private errorSubscription: EventSubscription | null = null;
  private startSubscription: EventSubscription | null = null;
  private endSubscription: EventSubscription | null = null;
  private singleUseResolve: ((text: string) => void) | null = null;
  private singleUseReject: ((error: Error) => void) | null = null;

  private async resolveAndroidLocale(requestedLocale: string): Promise<string> {
    if (Platform.OS !== "android") return requestedLocale;
    try {
      const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({ androidRecognitionServicePackage: ANDROID_ON_DEVICE_SERVICE });
      const installed = supported.installedLocales ?? [];
      if (installed.length === 0) {
        throw new Error("No Android offline speech model is installed. Install an offline speech language in Android System Intelligence / On-device speech recognition settings.");
      }
      const requested = requestedLocale.toLowerCase();
      const requestedLanguage = requested.split("-")[0];
      const exact = installed.find((locale) => locale.toLowerCase() === requested);
      if (exact) return exact;
      const sameLanguage = installed.find((locale) => locale.toLowerCase().split("-")[0] === requestedLanguage);
      if (sameLanguage) return sameLanguage;
      const english = installed.find((locale) => locale.toLowerCase() === DEFAULT_LOCALE.toLowerCase());
      if (english) return english;
      return installed[0];
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No Android offline")) throw error;
      throw new Error("Android offline speech recognition models could not be queried. Check that Android System Intelligence / On-device speech recognition is enabled.");
    }
  }

  async listenForSpeech(locale = DEFAULT_LOCALE): Promise<string> {
    if (this.isListening) return "";
    return new Promise(async (resolve, reject) => {
      this.singleUseResolve = resolve;
      this.singleUseReject = reject;
      this.removeNativeListeners();
      this.startSubscription = ExpoSpeechRecognitionModule.addListener("start", () => {
        this.isListening = true;
        this.onStartCallbacks.forEach((cb) => cb());
      });
      this.endSubscription = ExpoSpeechRecognitionModule.addListener("end", () => {
        this.isListening = false;
        this.onEndCallbacks.forEach((cb) => cb());
      });
      this.resultSubscription = ExpoSpeechRecognitionModule.addListener("result", (event) => {
        const text = event.results?.[0]?.transcript?.trim() ?? "";
        if (!text) return;
        this.onResultsCallbacks.forEach((cb) => cb(text));
        if (event.isFinal) this.resolveSingleUse(text);
      });
      this.errorSubscription = ExpoSpeechRecognitionModule.addListener("error", (event) => {
        const message = event.message || event.error || "Speech recognition error";
        console.error("STT error:", event.error, message, event.code);
        this.onErrorCallbacks.forEach((cb) => cb(message));
        this.rejectSingleUse(new Error(message));
      });
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) throw new Error("Microphone/speech recognition permission was denied");
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) throw new Error("No speech recognition service is available on this device");
        const recognitionLocale = await this.resolveAndroidLocale(locale);
        ExpoSpeechRecognitionModule.start({ lang: recognitionLocale, interimResults: true, maxAlternatives: 1, continuous: false, requiresOnDeviceRecognition: Platform.OS === "android", addsPunctuation: false });
      } catch (error) {
        this.rejectSingleUse(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async startListening(locale = DEFAULT_LOCALE): Promise<void> {
    if (this.isListening) return;
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) throw new Error("Microphone permission was denied");
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) throw new Error("No speech recognition service is available on this device");
      this.removeNativeListeners();
      this.startSubscription = ExpoSpeechRecognitionModule.addListener("start", () => {
        this.isListening = true;
        this.onStartCallbacks.forEach((cb) => cb());
      });
      this.endSubscription = ExpoSpeechRecognitionModule.addListener("end", () => {
        this.isListening = false;
        this.onEndCallbacks.forEach((cb) => cb());
      });
      this.errorSubscription = ExpoSpeechRecognitionModule.addListener("error", (event) => {
        const message = event.message || event.error || "Speech recognition error";
        console.error("STT error:", event.error, message, event.code);
        this.onErrorCallbacks.forEach((cb) => cb(message));
      });
      const recognitionLocale = await this.resolveAndroidLocale(locale);
      ExpoSpeechRecognitionModule.start({ lang: recognitionLocale, interimResults: true, maxAlternatives: 1, continuous: false, requiresOnDeviceRecognition: Platform.OS === "android", addsPunctuation: false });
    } catch (error) {
      this.isListening = false;
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    if (this.isListening) ExpoSpeechRecognitionModule.stop();
  }

  async cancel(): Promise<void> {
    ExpoSpeechRecognitionModule.abort();
    this.isListening = false;
    this.rejectSingleUse(new Error("Speech recognition cancelled"));
    this.removeNativeListeners();
  }

  getModalState(): STTModalState { return { visible: this.isListening }; }
  handleTextInput(text: string): void { this.resolveSingleUse(text.trim()); }
  onResults(callback: (text: string) => void): void { this.onResultsCallbacks.push(callback); }
  onError(callback: (error: string) => void): void { this.onErrorCallbacks.push(callback); }
  onStart(callback: () => void): void { this.onStartCallbacks.push(callback); }
  onEnd(callback: () => void): void { this.onEndCallbacks.push(callback); }
  getIsListening(): boolean { return this.isListening; }

  private resolveSingleUse(text: string): void {
    this.isListening = false;
    const resolve = this.singleUseResolve;
    this.singleUseResolve = null;
    this.singleUseReject = null;
    this.removeNativeListeners();
    if (text) resolve?.(text);
  }

  private rejectSingleUse(error: Error): void {
    this.isListening = false;
    const reject = this.singleUseReject;
    this.singleUseResolve = null;
    this.singleUseReject = null;
    this.removeNativeListeners();
    reject?.(error);
  }

  private removeNativeListeners(): void {
    this.resultSubscription?.remove();
    this.errorSubscription?.remove();
    this.startSubscription?.remove();
    this.endSubscription?.remove();
    this.resultSubscription = null;
    this.errorSubscription = null;
    this.startSubscription = null;
    this.endSubscription = null;
  }

  async cleanup(): Promise<void> {
    try { if (this.isListening) ExpoSpeechRecognitionModule.abort(); } catch {}
    this.isListening = false;
    this.singleUseResolve = null;
    this.singleUseReject = null;
    this.removeNativeListeners();
    this.onResultsCallbacks = [];
    this.onErrorCallbacks = [];
    this.onStartCallbacks = [];
    this.onEndCallbacks = [];
  }
}

let sttInstance: SpeechToTextService | null = null;
export function getSpeechToTextService(): SpeechToTextService {
  if (!sttInstance) sttInstance = new SpeechToTextService();
  return sttInstance;
}
