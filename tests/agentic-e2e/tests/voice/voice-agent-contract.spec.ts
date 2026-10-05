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
import { test } from "@playwright/test";

import {
  CALL_VERDICT_TIMEOUT_MS,
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

test.describe("Voice agent simulation contract", () => {
  // Each test places a real call that can take up to ~2 minutes, so the whole
  // test is given the call-length budget rather than the suite default.
  test.setTimeout(CALL_VERDICT_TIMEOUT_MS + 120_000);

  /** @scenario "Simulate a call against a voice agent reachable by phone number" */
  test("simulates a call against a voice agent reachable by phone number", async ({
    page,
  }) => {
    const creds = phoneCredsFromEnv();
    test.skip(
      creds === null,
      "Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and E2E_VOICE_PHONE_NUMBER",
    );
    const phone = creds!;

    // Given a LangWatch user with a project, and a voice agent reachable by a
    // phone number alone.
    await givenAUserWithAProject(page);
    await givenTheProjectHasTwilio(page, phone);
    await givenAVoiceAgentExists(page, {
      name: "E2E Phone Agent",
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
    await whenTheyRunTheSimulation(page, { name: "E2E Phone Agent" });

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
    const creds = elevenLabsCredsFromEnv();
    test.skip(
      creds === null,
      "Requires ELEVENLABS_API_KEY and E2E_ELEVENLABS_AGENT_ID",
    );
    const eleven = creds!;

    // Given a LangWatch user with a project, and a voice agent reachable
    // through ElevenLabs.
    await givenAUserWithAProject(page);
    await givenTheProjectHasElevenLabs(page, eleven);
    await givenAVoiceAgentExists(page, {
      name: "E2E ElevenLabs Agent",
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
    await whenTheyRunTheSimulation(page, { name: "E2E ElevenLabs Agent" });

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
