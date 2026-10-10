import type { Named } from "@langwatch/module";
import { z } from "zod";

import { VOICE_TRANSPORTS } from "./voice-transport.ts";

/** Main's `POST /api/voice/session` body: mint a signed-URL session. */
const voiceSessionMintInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  transport: z.enum(VOICE_TRANSPORTS),
  /** The vendor agent id from the form; a saved row's own id always wins. */
  agentId: z.string().trim().min(1).max(128),
  agentRowId: z.string().min(1).optional(),
});
export interface VoiceSessionMintInputSchema extends Named<
  typeof voiceSessionMintInputSchemaDefinition
> {}
export const voiceSessionMintInputSchema: VoiceSessionMintInputSchema =
  voiceSessionMintInputSchemaDefinition;
export type VoiceSessionMintInput = z.input<typeof voiceSessionMintInputSchema>;

const voiceTranscriptTurnSchemaDefinition = z.object({
  role: z.enum(["caller", "agent"]),
  text: z.string(),
});
export interface VoiceTranscriptTurnSchema extends Named<
  typeof voiceTranscriptTurnSchemaDefinition
> {}
export const voiceTranscriptTurnSchema: VoiceTranscriptTurnSchema =
  voiceTranscriptTurnSchemaDefinition;
export type VoiceTranscriptTurn = z.infer<typeof voiceTranscriptTurnSchema>;

/** Main's `POST /api/voice/session/:sessionId/finish` body: ingest the finished call. */
const voiceSessionFinishInputSchemaDefinition = z.object({
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
export interface VoiceSessionFinishInputSchema extends Named<
  typeof voiceSessionFinishInputSchemaDefinition
> {}
export const voiceSessionFinishInputSchema: VoiceSessionFinishInputSchema =
  voiceSessionFinishInputSchemaDefinition;
export type VoiceSessionFinishInput = z.input<typeof voiceSessionFinishInputSchema>;
/** Main's finish path names the session; the signed token in the body is what is trusted. */
const voiceSessionFinishParamsSchemaDefinition = z.object({ sessionId: z.string().min(1) });
export interface VoiceSessionFinishParamsSchema extends Named<
  typeof voiceSessionFinishParamsSchemaDefinition
> {}
export const voiceSessionFinishParamsSchema: VoiceSessionFinishParamsSchema =
  voiceSessionFinishParamsSchemaDefinition;

/** Main's mint response: the signed URL to connect with, and the token finish carries back. */
const voiceSessionMintResultSchemaDefinition = z.object({
  transport: z.enum(VOICE_TRANSPORTS),
  sessionToken: z.string(),
  maxDurationSeconds: z.number(),
  connect: z.object({ signedUrl: z.string() }),
});
export interface VoiceSessionMintResultSchema extends Named<
  typeof voiceSessionMintResultSchemaDefinition
> {}
export const voiceSessionMintResultSchema: VoiceSessionMintResultSchema =
  voiceSessionMintResultSchemaDefinition;
export type VoiceSessionMintResult = z.infer<typeof voiceSessionMintResultSchema>;

/** Main's finish response: the run written, where its turns came from and its recording. */
const voiceSessionFinishResultSchemaDefinition = z.object({
  runId: z.string(),
  agentId: z.string(),
  source: z.enum(["provider", "browser"]),
  hasFetchFailed: z.boolean(),
  hasAudio: z.boolean(),
  audioUrl: z.string().optional(),
  scenarioSetId: z.string().optional(),
});
export interface VoiceSessionFinishResultSchema extends Named<
  typeof voiceSessionFinishResultSchemaDefinition
> {}
export const voiceSessionFinishResultSchema: VoiceSessionFinishResultSchema =
  voiceSessionFinishResultSchemaDefinition;
export type VoiceSessionFinishResult = z.infer<typeof voiceSessionFinishResultSchema>;

/** Who asks: every voice door authorizes the caller itself, as main's handlers did. */
export type VoiceSessionMintRequest = z.output<typeof voiceSessionMintInputSchema> & {
  userId: string;
};
export type VoiceSessionFinishRequest = z.output<typeof voiceSessionFinishInputSchema> & {
  userId: string;
};

/** Main's `GET /api/voice/session/:conversationId/audio`: the recording, streamed server-side. */
const voiceSessionAudioParamsSchemaDefinition = z.object({
  conversationId: z.string().min(1).max(200),
});
export interface VoiceSessionAudioParamsSchema extends Named<
  typeof voiceSessionAudioParamsSchemaDefinition
> {}
export const voiceSessionAudioParamsSchema: VoiceSessionAudioParamsSchema =
  voiceSessionAudioParamsSchemaDefinition;
const voiceSessionAudioQuerySchemaDefinition = z.object({ projectId: z.string().min(1) });
export interface VoiceSessionAudioQuerySchema extends Named<
  typeof voiceSessionAudioQuerySchemaDefinition
> {}
export const voiceSessionAudioQuerySchema: VoiceSessionAudioQuerySchema =
  voiceSessionAudioQuerySchemaDefinition;
export type VoiceSessionAudioRequest = {
  projectId: string;
  conversationId: string;
  userId: string;
  signal?: AbortSignal;
};
/** Main's `GET /api/voice/run/:scenarioRunId/audio`: a headless run's whole-call recording. */
const voiceRunAudioParamsSchemaDefinition = z.object({
  scenarioRunId: z.string().min(1).max(200),
});
export interface VoiceRunAudioParamsSchema extends Named<
  typeof voiceRunAudioParamsSchemaDefinition
> {}
export const voiceRunAudioParamsSchema: VoiceRunAudioParamsSchema =
  voiceRunAudioParamsSchemaDefinition;
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
