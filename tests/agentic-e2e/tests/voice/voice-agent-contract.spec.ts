/**
 * Voice-agent simulation contract — end-to-end.
 *
 * Binds the two merged contract scenarios to real Playwright journeys that
 * drive the whole flow through the UI: author a scenario, pick the voice agent,
 * run it, and read the verdict, the transcript, the call audio, and the traces.
 *
 * Source of truth (do not diverge — these files are the contract):
 *  - specs/simulation-testing/voice-agents/testing-phone-agents.feature
 *  - specs/simulation-testing/voice-agents/testing-elevenlabs-convai.feature
 *
 * Both tests place a REAL third-party call, so they gate on live credentials
 * and skip cleanly when any is absent (the agentic-e2e suite has no prior
 * credential-gated precedent, so this mirrors the `test.skip(cond, reason)`
 * pattern the repo's vitest suites use).
 *
 * Required environment:
 *   Phone (testing-phone-agents.feature):
 *     TWILIO_ACCOUNT_SID     — Twilio account SID that can place calls
 *     TWILIO_AUTH_TOKEN      — Twilio auth token
 *     TWILIO_FROM_NUMBER     — the E.164 number Twilio dials from
 *     E2E_VOICE_PHONE_NUMBER — the E.164 number of the agent under test to call
 *   ElevenLabs (testing-elevenlabs-convai.feature):
 *     ELEVENLABS_API_KEY     — ElevenLabs key that can sign a ConvAI session
 *     E2E_ELEVENLABS_AGENT_ID— the ElevenLabs agent id to talk to
 *
 * Also required in the target project (environment prerequisites, not gated
 * here): the `release_voice_agents_enabled` feature flag on, and an LLM model
 * provider so the simulated user and the judge can run. Pin a fresh project
 * with E2E_PROJECT_SLUG so the voice agent can be created through the Agents
 * page (see givenAVoiceAgentExists in steps.ts).
 */
import { randomUUID } from "node:crypto";

import { test } from "@playwright/test";

import {
  CALL_START_TIMEOUT_MS,
  CALL_VERDICT_TIMEOUT_MS,
  MAX_AUDIO_PARTS_BUDGETED,
  TRACE_INGESTION_TIMEOUT_MS,
  WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS,
  elevenLabsCredsFromEnv,
  givenAUserWithAProject,
  givenAVoiceAgentExists,
  givenTheProjectHasElevenLabs,
  givenTheProjectHasTwilio,
  givenTheyAreOnTheSimulationsPage,
  phoneCredsFromEnv,
  thenASimulatedUserTalksToTheAgent,
  thenEachTurnHasAudio,
  thenTheCallIsOneTrace,
  thenTheCallIsPlaced,
  thenTheRunIsJudgedAgainstCriteria,
  thenTheTraceCarriesCallMetadata,
  thenTheTraceCarriesTwilioMetadata,
  thenTheTracesCarryTheAudio,
  thenTheyCanListenToTheWholeCall,
  thenTheyCanReachThreadsAndTraces,
  thenTheyCanSeeTheResults,
  thenTheyCanSeeTheTranscript,
  whenTheyAuthorAScenarioWithCriteria,
  whenTheyFollowTheTracesLink,
  whenTheyRunTheSimulation,
} from "./steps";

/**
 * UI settle time not covered by any single phase constant below: page
 * navigation, scenario authoring, provider setup, the run dialog, and the
 * trace drawer's own short (5-15s) internal waits. Named rather than folded
 * into one of the phase constants, so a future phase change doesn't have to
 * hunt for where the slack was hiding.
 */
const SETUP_MARGIN_MS = 60_000;

/**
 * Generates a fresh agent name per test run.
 *
 * The project is reused across runs, so a fixed agent name accumulates
 * duplicate cards over time and `whenTheyRunTheSimulation` picks the first
 * one matching by name — which can be a stale card from an earlier run, not
 * the one this run just created. A unique name keeps the selection honest.
 *
 * Uses `randomUUID` rather than `Math.random`: the name is only a test
 * label, but it flows into a created agent record, and CodeQL's
 * js/insecure-randomness rule treats that as a security context and
 * fails the build. A real random source costs nothing here and keeps
 * the check green without an inline suppression.
 */
function uniqueAgentName(prefix: string): string {
  return `${prefix} ${Date.now()}-${randomUUID().slice(0, 8)}`;
}

test.describe("Voice agent simulation contract", () => {
  /** @scenario "Simulate a call against a voice agent reachable by phone number" */
  test("simulates a call against a voice agent reachable by phone number", async ({
    page,
  }) => {
    // Each phase below waits up to its own named ceiling, and this test's
    // budget is the honest sum of every sequential await downstream that can
    // legitimately need its full ceiling — not just one occurrence of each
    // constant:
    //   CALL_START_TIMEOUT_MS               x1  thenTheCallIsPlaced
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenASimulatedUserTalksToTheAgent
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenTheRunIsJudgedAgainstCriteria
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenTheyCanListenToTheWholeCall
    //                                              (audio element visible)
    //   WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS     x1  thenTheyCanListenToTheWholeCall
    //                                              (recording-publish poll)
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenEachTurnHasAudio
    //                                              (first part visible)
    //   CALL_VERDICT_TIMEOUT_MS  x MAX_AUDIO_PARTS_BUDGETED  thenEachTurnHasAudio
    //                                              (per-part waits, bounded —
    //                                              not an unbounded sum)
    //   TRACE_INGESTION_TIMEOUT_MS           x3  whenTheyFollowTheTracesLink,
    //                                              thenTheCallIsOneTrace,
    //                                              thenTheTracesCarryTheAudio
    //                                              (via reopenTheOneTrace)
    //   SETUP_MARGIN_MS                      x1  everything else
    test.setTimeout(
      CALL_START_TIMEOUT_MS +
        CALL_VERDICT_TIMEOUT_MS * (4 + MAX_AUDIO_PARTS_BUDGETED) +
        WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS +
        TRACE_INGESTION_TIMEOUT_MS * 3 +
        SETUP_MARGIN_MS,
    );

    const creds = phoneCredsFromEnv();
    test.skip(
      creds === null,
      "Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and E2E_VOICE_PHONE_NUMBER",
    );
    const phone = creds!;
    const agentName = uniqueAgentName("E2E Phone Agent");

    // Given a LangWatch user with a project, and a voice agent reachable by a
    // phone number alone.
    await givenAUserWithAProject(page);
    await givenTheProjectHasTwilio(page, phone);
    await givenAVoiceAgentExists(page, {
      name: agentName,
      transport: "phone",
      phoneNumber: phone.toNumber,
    });
    await givenTheyAreOnTheSimulationsPage(page);

    // When they author a scenario against that voice agent and provide the
    // criteria the simulation is judged on.
    await whenTheyAuthorAScenarioWithCriteria(page, {
      title: `Phone voice agent ${Date.now()}`,
      situation: "A caller asks the agent to confirm today's opening hours.",
      criteria: [
        "The agent answers the call",
        "The agent states the opening hours",
      ],
    });

    // And they run the simulation against that voice agent.
    await whenTheyRunTheSimulation(page, { name: agentName });

    // Then LangWatch places a call to that phone number.
    await thenTheCallIsPlaced(page);
    // And a simulated user talks to their voice agent over the phone.
    await thenASimulatedUserTalksToTheAgent(page);
    // And the run is judged against their criteria.
    await thenTheRunIsJudgedAgainstCriteria(page);
    // And they can see the results.
    await thenTheyCanSeeTheResults(page);
    // And they can see the whole conversation as a transcript.
    await thenTheyCanSeeTheTranscript(page);
    // And they can listen to the whole call.
    await thenTheyCanListenToTheWholeCall(page);
    // And they can listen to each part of the conversation.
    await thenEachTurnHasAudio(page);
    // And they can see the threads and traces for their agent and the runner.
    await thenTheyCanReachThreadsAndTraces(page);
    // And the call is one trace for its whole length.
    await whenTheyFollowTheTracesLink(page);
    await thenTheCallIsOneTrace(page);
    // And the traces carry the audio and they can listen to it there.
    await thenTheTracesCarryTheAudio(page);
    // And the traces carry all the metadata the call makes available.
    await thenTheTraceCarriesTwilioMetadata(page);
  });

  /** @scenario "Simulate a call against a voice agent reachable through ElevenLabs" */
  test("simulates a call against a voice agent reachable through ElevenLabs", async ({
    page,
  }) => {
    // This journey has no separate call-placement phase (no queued state to
    // leave before ElevenLabs joins), so its budget omits CALL_START_TIMEOUT_MS,
    // and it never calls thenTheCallIsOneTrace, so it only pays
    // TRACE_INGESTION_TIMEOUT_MS twice, not three times — everything else is
    // the same sequential sum as the phone test above:
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenASimulatedUserTalksToTheAgent
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenTheRunIsJudgedAgainstCriteria
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenTheyCanListenToTheWholeCall
    //                                              (audio element visible)
    //   WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS     x1  thenTheyCanListenToTheWholeCall
    //                                              (recording-publish poll)
    //   CALL_VERDICT_TIMEOUT_MS              x1  thenEachTurnHasAudio
    //                                              (first part visible)
    //   CALL_VERDICT_TIMEOUT_MS  x MAX_AUDIO_PARTS_BUDGETED  thenEachTurnHasAudio
    //                                              (per-part waits, bounded —
    //                                              not an unbounded sum)
    //   TRACE_INGESTION_TIMEOUT_MS           x2  whenTheyFollowTheTracesLink,
    //                                              thenTheTracesCarryTheAudio
    //                                              (via reopenTheOneTrace)
    //   SETUP_MARGIN_MS                      x1  everything else
    test.setTimeout(
      CALL_VERDICT_TIMEOUT_MS * (4 + MAX_AUDIO_PARTS_BUDGETED) +
        WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS +
        TRACE_INGESTION_TIMEOUT_MS * 2 +
        SETUP_MARGIN_MS,
    );

    const creds = elevenLabsCredsFromEnv();
    test.skip(
      creds === null,
      "Requires ELEVENLABS_API_KEY and E2E_ELEVENLABS_AGENT_ID",
    );
    const eleven = creds!;
    const agentName = uniqueAgentName("E2E ElevenLabs Agent");

    // Given a LangWatch user with a project, and a voice agent reachable
    // through ElevenLabs.
    await givenAUserWithAProject(page);
    await givenTheProjectHasElevenLabs(page, eleven);
    await givenAVoiceAgentExists(page, {
      name: agentName,
      transport: "elevenlabs_convai",
      agentId: eleven.agentId,
    });
    await givenTheyAreOnTheSimulationsPage(page);

    // When they author a scenario against that voice agent and provide the
    // criteria the simulation is judged on.
    await whenTheyAuthorAScenarioWithCriteria(page, {
      title: `ElevenLabs voice agent ${Date.now()}`,
      situation: "A caller asks the agent to confirm today's opening hours.",
      criteria: [
        "The agent responds to the caller",
        "The agent states the opening hours",
      ],
    });

    // And they run the simulation against that voice agent.
    await whenTheyRunTheSimulation(page, { name: agentName });

    // Then a simulated user talks to their voice agent.
    await thenASimulatedUserTalksToTheAgent(page);
    // And the run is judged against their criteria.
    await thenTheRunIsJudgedAgainstCriteria(page);
    // And they can see the results.
    await thenTheyCanSeeTheResults(page);
    // And they can see the whole conversation as a transcript.
    await thenTheyCanSeeTheTranscript(page);
    // And they can listen to the whole call.
    await thenTheyCanListenToTheWholeCall(page);
    // And they can listen to each part of the conversation.
    await thenEachTurnHasAudio(page);
    // And they can see the threads and traces for their agent and the runner.
    await thenTheyCanReachThreadsAndTraces(page);
    // And the traces carry the audio and they can listen to it there.
    await whenTheyFollowTheTracesLink(page);
    await thenTheTracesCarryTheAudio(page);
    // And the traces carry all the metadata the call makes available.
    await thenTheTraceCarriesCallMetadata(page);
  });
});
