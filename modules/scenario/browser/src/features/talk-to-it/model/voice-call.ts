import type {
  VoiceSessionFinishInput,
  VoiceSessionFinishResult,
  VoiceSessionMintInput,
  VoiceSessionMintResult,
  VoiceTranscriptTurn,
} from "@langwatch/scenario-contract";

/** One transcript turn as it arrives live from the transport. */
export type VoiceTurn = VoiceTranscriptTurn;

export interface VoiceCallHandlers {
  onConnected: (info: { conversationId: string }) => void;
  onTranscript: (turn: VoiceTurn) => void;
  onModeChange?: (mode: "speaking" | "listening") => void;
  onDisconnect: () => void;
  onError: (error: Error) => void;
}

export interface VoiceCallSession {
  /** End the call and release the microphone. */
  hangUp: () => Promise<void>;
  /** Current mic input level 0..1, for the live meter, when the transport exposes it. */
  getInputVolume?: () => number;
}

export interface VoiceTransportClient {
  openCall(input: { signedUrl: string; handlers: VoiceCallHandlers }): Promise<VoiceCallSession>;
}

/** What a refusal from the session doors says: its handled code, when it has one, and the words. */
export type VoiceSessionFailure = { code?: string; message: string };

/** The voice-session doors, wired by each consumer over its own contract-derived client. */
export interface VoiceSessionClient {
  mint(input: VoiceSessionMintInput): Promise<VoiceSessionMintResult>;
  finish(input: VoiceSessionFinishInput): Promise<VoiceSessionFinishResult>;
  describeFailure(error: unknown): VoiceSessionFailure;
}
