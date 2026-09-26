import { z } from "zod";

import { VOICE_TRANSPORTS } from "./voice-transport.ts";

/** Main's `POST /api/voice/session` body: mint a signed-URL session. */
export const voiceSessionMintInputSchema = z.object({
  projectId: z.string().min(1),
  transport: z.enum(VOICE_TRANSPORTS),
  /** The vendor agent id from the form; a saved row's own id always wins. */
  agentId: z.string().trim().min(1).max(128),
  agentRowId: z.string().min(1).optional(),
});
export type VoiceSessionMintInput = z.input<typeof voiceSessionMintInputSchema>;

export const voiceTranscriptTurnSchema = z.object({
  role: z.enum(["caller", "agent"]),
  text: z.string(),
});
export type VoiceTranscriptTurn = z.infer<typeof voiceTranscriptTurnSchema>;

/** Main's `POST /api/voice/session/:sessionId/finish` body: ingest the finished call. */
export const voiceSessionFinishInputSchema = z.object({
  projectId: z.string().min(1),
  /** The signed token from mint, carrying the project, transport and agent the finish trusts. */
  sessionToken: z.string().min(1),
  name: z.string().trim().max(200).optional(),
  conversationId: z.string().trim().max(200).optional(),
  transcript: z.array(voiceTranscriptTurnSchema).default([]),
  startedAt: z.number(),
  endedAt: z.number(),
  isCutAtLimit: z.boolean().default(false),
  /** Set for a "Call it myself" run: the scenario the call is scored under (AC23). */
  scenarioId: z.string().trim().min(1).optional(),
});
export type VoiceSessionFinishInput = z.input<typeof voiceSessionFinishInputSchema>;

/** Main's mint response: the signed URL to connect with, and the token finish carries back. */
export const voiceSessionMintResultSchema = z.object({
  transport: z.enum(VOICE_TRANSPORTS),
  sessionToken: z.string(),
  maxDurationSeconds: z.number(),
  connect: z.object({ signedUrl: z.string() }),
});
export type VoiceSessionMintResult = z.infer<typeof voiceSessionMintResultSchema>;

/** Main's finish response: the run written, where its turns came from and its recording. */
export const voiceSessionFinishResultSchema = z.object({
  runId: z.string(),
  agentId: z.string(),
  source: z.enum(["provider", "browser"]),
  hasFetchFailed: z.boolean(),
  hasAudio: z.boolean(),
  audioUrl: z.string().optional(),
  scenarioSetId: z.string().optional(),
});
export type VoiceSessionFinishResult = z.infer<typeof voiceSessionFinishResultSchema>;

/** Who asks: every voice door authorizes the caller itself, as main's handlers did. */
export type VoiceSessionMintRequest = z.output<typeof voiceSessionMintInputSchema> & {
  userId: string;
};
export type VoiceSessionFinishRequest = z.output<typeof voiceSessionFinishInputSchema> & {
  userId: string;
};

/** Main's `GET /api/voice/session/:conversationId/audio`: the recording, streamed server-side. */
export const voiceSessionAudioParamsSchema = z.object({
  conversationId: z.string().min(1).max(200),
});
export const voiceSessionAudioQuerySchema = z.object({ projectId: z.string().min(1) });
export type VoiceSessionAudioRequest = {
  projectId: string;
  conversationId: string;
  userId: string;
  signal?: AbortSignal;
};
/** Main's `GET /api/voice/run/:scenarioRunId/audio`: a headless run's whole-call recording. */
export const voiceRunAudioParamsSchema = z.object({
  scenarioRunId: z.string().min(1).max(200),
});
export type VoiceRunAudioRequest = {
  projectId: string;
  scenarioRunId: string;
  userId: string;
  signal?: AbortSignal;
};
/** The provider's bytes relayed as they arrive; the key never leaves the server. */
export type VoiceRecordingStream = { stream: ReadableStream<Uint8Array>; mediaType: "audio/mpeg" };
/** A whole-call recording: ElevenLabs serves mpeg, Twilio serves wav. */
export type VoiceRunRecordingStream = {
  stream: ReadableStream<Uint8Array>;
  mediaType: "audio/mpeg" | "audio/wav";
};
