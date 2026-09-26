import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  ScenarioApi,
  voiceRunAudioParamsSchema,
  voiceSessionAudioParamsSchema,
  voiceSessionAudioQuerySchema,
} from "@langwatch/scenario-contract";

/** Main's recording door: the provider's bytes stream through, and its key stays server-side. */
export const scenarioVoiceRest = defineRestRouter(ScenarioApi)
  .withNamespace("scenario-voice")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("browser")
  .get("/api/voice/session/:conversationId/audio", "streamVoiceSessionAudio")
  .withParams(voiceSessionAudioParamsSchema)
  .withQuery(voiceSessionAudioQuerySchema)
  .withPermission("scenarios:view", { at: "route", param: "projectId" })
  .withResponse("bytes", { produces: "audio/mpeg" })
  .withDocs({ description: "Stream a voice call's recording from its provider" })
  .handle(async ({ app, input, actor, signal, response }) => {
    const recording = await app.streamVoiceSessionAudio({
      projectId: input.projectId,
      conversationId: input.conversationId,
      userId: actor.id,
      signal,
    });

    return response.stream(recording.stream, {
      mediaType: recording.mediaType,
      headers: { "Cache-Control": "no-store" },
    });
  })
  .get("/api/voice/run/:scenarioRunId/audio", "streamVoiceRunAudio")
  .withParams(voiceRunAudioParamsSchema)
  .withQuery(voiceSessionAudioQuerySchema)
  .withPermission("scenarios:view", { at: "route", param: "projectId" })
  .withResponse("bytes", { produces: ["audio/mpeg", "audio/wav"] })
  .withDocs({ description: "Stream a headless voice run's whole-call recording from its provider" })
  .handle(async ({ app, input, actor, signal, response }) => {
    const recording = await app.streamVoiceRunAudio({
      projectId: input.projectId,
      scenarioRunId: input.scenarioRunId,
      userId: actor.id,
      signal,
    });

    return response.stream(recording.stream, {
      mediaType: recording.mediaType,
      headers: { "Cache-Control": "no-store" },
    });
  })
  .build();
