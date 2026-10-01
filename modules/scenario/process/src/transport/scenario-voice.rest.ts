import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  ScenarioApi,
  voiceRunAudioParamsSchema,
  voiceSessionAudioParamsSchema,
  voiceSessionAudioQuerySchema,
  voiceSessionFinishInputSchema,
  voiceSessionFinishParamsSchema,
  voiceSessionFinishResultSchema,
  voiceSessionMintInputSchema,
  voiceSessionMintResultSchema,
} from "@langwatch/scenario-contract";

const VOICE_SESSION_AUTHORIZED_BY_THE_APP =
  "The voice flag and scenarios:create are checked in the app; evaluations:manage only when the " +
  "call creates an agent, which a finish learns from its verified session token (#8021).";

/** Main's "Talk to it" doors: mint and finish a browser call, and stream its recording. */
export const scenarioVoiceRest = defineRestRouter(ScenarioApi)
  .withNamespace("scenario-voice")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("browser")
  .post("/api/voice/session", "mintVoiceSession")
  .withInput(voiceSessionMintInputSchema)
  .withAccess(anyAuthenticated({ reason: VOICE_SESSION_AUTHORIZED_BY_THE_APP }))
  .withOutput(voiceSessionMintResultSchema)
  .withDocs({ description: "Mint a signed-URL session for a browser voice call" })
  .handle(({ app, input, actor }) => app.mintVoiceSession({ ...input, userId: actor.id }))
  .post("/api/voice/session/:sessionId/finish", "finishVoiceSession")
  .withParams(voiceSessionFinishParamsSchema)
  .withInput(voiceSessionFinishInputSchema)
  .withAccess(anyAuthenticated({ reason: VOICE_SESSION_AUTHORIZED_BY_THE_APP }))
  .withOutput(voiceSessionFinishResultSchema)
  .withDocs({ description: "Ingest a finished browser voice call as a scenario run" })
  .handle(({ app, input: { sessionId: _sessionId, ...call }, actor }) =>
    app.finishVoiceSession({ ...call, userId: actor.id }),
  )
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
