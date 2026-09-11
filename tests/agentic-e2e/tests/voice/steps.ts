/**
 * Step definitions for the voice-agent simulation contract tests.
 *
 * Named to match the Gherkin of the two contract feature files:
 *  - specs/simulation-testing/voice-agents/testing-phone-agents.feature
 *  - specs/simulation-testing/voice-agents/testing-elevenlabs-convai.feature
 *
 * The whole journey is driven through the UI by clicking, exactly as a person
 * runs it: the agent is created up front through the Agents page's voice
 * drawer, the scenario is authored in the scenario editor, and the run is
 * started from the run dialog. Nothing
 * here calls an API to TRIGGER a run — the one API use is precondition setup
 * (the provider credential row), which mirrors auth.setup.ts creating the org
 * and project over tRPC rather than clicking through onboarding.
 *
 * This file is a barrel: the actual step implementations are split by
 * responsibility into sibling modules, kept under the repo's per-file line
 * limit. `voice-agent-contract.spec.ts` imports everything from here so its
 * own import list does not need to know the split.
 *  - ./constants          — shared timeouts
 *  - ./credentials        — env-var credential gates + project/provider setup
 *  - ./scenario           — creating the agent, authoring, running, the verdict
 *  - ./audio              — whole-call and per-turn audio assertions
 *  - ./trace-navigation   — opening the trace drawer, the one-trace assertion
 *  - ./trace-attributes   — span attribute selection, audio-in-traces, metadata
 *
 * @see specs/simulation-testing/voice-agents/testing-phone-agents.feature
 * @see specs/simulation-testing/voice-agents/testing-elevenlabs-convai.feature
 */
export {
  CALL_START_TIMEOUT_MS,
  CALL_VERDICT_TIMEOUT_MS,
  TRACE_INGESTION_TIMEOUT_MS,
  WHOLE_CALL_AUDIO_POLL_INTERVAL_MS,
  WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS,
} from "./constants";

export {
  type ElevenLabsCreds,
  type PhoneCreds,
  elevenLabsCredsFromEnv,
  givenAUserWithAProject,
  givenTheProjectHasElevenLabs,
  givenTheProjectHasTwilio,
  phoneCredsFromEnv,
} from "./credentials";

export {
  givenAVoiceAgentExists,
  givenTheyAreOnTheSimulationsPage,
  thenASimulatedUserTalksToTheAgent,
  thenTheCallIsPlaced,
  thenTheRunIsJudgedAgainstCriteria,
  thenTheyCanSeeTheResults,
  thenTheyCanSeeTheTranscript,
  whenTheyAuthorAScenarioWithCriteria,
  whenTheyRunTheSimulation,
} from "./scenario";

export { thenEachTurnHasAudio, thenTheyCanListenToTheWholeCall } from "./audio";

export {
  thenTheCallIsOneTrace,
  thenTheyCanReachThreadsAndTraces,
  whenTheyFollowTheTracesLink,
} from "./trace-navigation";

export {
  thenTheTraceCarriesCallMetadata,
  thenTheTraceCarriesTwilioMetadata,
  thenTheTracesCarryTheAudio,
} from "./trace-attributes";
