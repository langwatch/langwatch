# Voice: open-issue triage, feature completeness, and draft user stories

Date: 2026-09-07
Sources: `langwatch/langwatch` @ `8b51631777`, `langwatch/scenario` @ `ae0c921c` (both latest `main`), GitHub open issues across the `langwatch` org.
Status: research document. Nothing in GitHub was created, labeled, or commented on. Any issue filing should go through `/create-issue`.

---

## 1. Headline

- **107 open voice/audio issues** across the org. Scenario SDK 80, platform 19, langwatch-saas 6, two elsewhere. None carry a `voice` or `audio` label, in any repo.
- **Roughly half look already shipped but never closed.** 48 issues reference a merged PR. Spot checks show that link is noisy (see 2.3), so treat it as "verify and close", not "closed".
- **Two urgent items.** An ElevenLabs key leaks through the Gemini passthrough lane (security, PR open), and a reproducible voice test failure is blocking all JavaScript CI in the scenario repo.
- **Feature completeness is strong at the edges, thin in the middle.** Scenario SDK voice testing and the trace/simulation audio players are mature. The gateway can mint realtime sessions but cannot relay or govern a call mid-flight. No audio evaluators, no SDK audio helpers, no voice in Langy.
- **Biggest product gap for "voice through the app".** The SDK computes per-run recordings, timelines, and latency metrics for every voice scenario, and none of it reaches the platform. The UI only ever sees per-message audio parts.

---

## 2. Open-issue triage

### 2.1 Urgent (act this week)

| Issue | Why | Bucket |
|---|---|---|
| https://github.com/langwatch/langwatch/issues/7825 | Gemini passthrough forwards a virtual key sent on `xi-api-key`. Credential leak between providers. Fix in https://github.com/langwatch/langwatch/pull/7830 | blocked on PR merge |
| https://github.com/langwatch/scenario/issues/882 | Realtime voice-to-voice example test fails reproducibly and blocks JS PR CI. P1. | blocked on https://github.com/langwatch/scenario/pull/873 and https://github.com/langwatch/scenario/pull/857 |
| https://github.com/langwatch/scenario/issues/854 | On-demand voice integration suites red since May/June. No priority label. | needs owner |
| https://github.com/langwatch/langwatch-saas/issues/968 and https://github.com/langwatch/langwatch-saas/issues/1034 | Customer CO3 ElevenLabs instrumentation thread hanging since 10 July. | ship now |

### 2.2 Platform and gateway (langwatch, langwatch-saas)

| Issue | Title | Bucket | Note |
|---|---|---|---|
| https://github.com/langwatch/langwatch/issues/1727 | EPIC: multimodal traces, images and audio in S3 | verify and close | Linked PR 6320 is unrelated. Scope was delivered by https://github.com/langwatch/langwatch/pull/5949 and https://github.com/langwatch/langwatch/pull/5307. |
| https://github.com/langwatch/langwatch/issues/1763 | PROPOSAL: Voice Agent API design | needs spec | Superseded in part by ADR-097 realtime broker. Decide keep or close. |
| https://github.com/langwatch/langwatch/issues/3964 | Presigned PUT+GET endpoints for audio assets | ship now | P1. Prereq for SDK upload helpers. |
| https://github.com/langwatch/langwatch/issues/3965 | ScenarioMessageRenderer fetches audio via presigned GET | ship now | Depends on 3964. |
| https://github.com/langwatch/langwatch/issues/3966 | Docs: audio storage end to end | ship now | After 3964/3965. |
| https://github.com/langwatch/langwatch/issues/3968 | Python SDK audio upload helper | ship now | Depends on 3964. Matches gap "no SDK audio helpers". |
| https://github.com/langwatch/langwatch/issues/3969 | TS SDK audio upload helper | ship now | Same. |
| https://github.com/langwatch/langwatch/issues/4157 | Sim run UI: image messages lack View Trace | verify | Linked PR 4156 fixed audio (4146), not images. Likely still open. |
| https://github.com/langwatch/langwatch/issues/4627 | Play whole voice conversation as one recording | partial, verify | Sequential playback shipped. Last comment says Phase A is parked on branch `feat/4627-conversation-sequential-audio`. |
| https://github.com/langwatch/langwatch/issues/4715 | Extractor does not externalize bytes in tool-call args | verify | Linked PR is in the scenario repo, not a fix here. |
| https://github.com/langwatch/langwatch/issues/4915 | Datasets: image cells through StoredObjectsService | ship now | Adjacent, not voice. |
| https://github.com/langwatch/langwatch/issues/5313 | Play all raw-PCM realtime formats inline | verify and close | `pcmToWav.ts` handles pcm16, g711 ulaw and alaw today. |
| https://github.com/langwatch/langwatch/issues/5539 | Scenario UI conversation view truncates transcription | ship now | P2, size XS. |
| https://github.com/langwatch/langwatch/issues/5582 | Simulations audio player seek does not work | needs spec | Likely blob served without range support. Quick investigation. |
| https://github.com/langwatch/langwatch/issues/6180 | Automate Scenario voice e2e against gateway audio endpoints | ship now | P1. Matches the one `@unimplemented` in `specs/ai-gateway/audio-endpoints.feature`. |
| https://github.com/langwatch/langwatch/issues/6283 | Attach a file to a scenario when authoring in UI | needs spec | Enabler for "upload a call recording" stories below. |
| https://github.com/langwatch/langwatch/issues/6290 | Gateway translated lanes drop valid params incl. audio | verify and close | Three merged PRs referenced. |
| https://github.com/langwatch/langwatch/issues/7048 | Cached audio tokens price as fresh | verify and close | PRs 7021 and 7066 merged. |
| https://github.com/langwatch/langwatch-saas/issues/494 | CORS on dataplane S3 buckets for audio | ship now | Prereq for presigned GET in browser. |
| https://github.com/langwatch/langwatch-saas/issues/796 | Azure blob as stored-objects write destination | ship now | Self-hosted voice customers on Azure. |
| https://github.com/langwatch/langwatch-saas/issues/799 | Media attachments hard-reject the whole scenario event without a stored-objects backend | ship now | P2. Silent data loss for self-hosted. |
| https://github.com/langwatch/langwatch-saas/issues/969 | CO3 outbound voice customer needs commercial owner | needs spec | Commercial, not engineering. |
| https://github.com/langwatch/tasks/issues/95 | Typecheck drift in voice-factories tests | ship now | Small. |
| https://github.com/langwatch/ai-interviewer-scenario-demo/issues/2 | Judge side-channel leaks as raw JSON bubble | needs spec | Demo repo. |

### 2.3 Scenario SDK (80 issues) by cluster

The linked-PR signal is a GitHub cross-reference, not a "closes" link. Spot checks in 2.2 found two of five links pointing at unrelated PRs. Read "verify and close" as a 30-second check per issue, not a batch close.

| Cluster | Issues | Bucket | One fix |
|---|---|---|---|
| Adapter transports shipped, issues never closed | https://github.com/langwatch/scenario/issues/356 https://github.com/langwatch/scenario/issues/358 https://github.com/langwatch/scenario/issues/361 https://github.com/langwatch/scenario/issues/362 https://github.com/langwatch/scenario/issues/363 https://github.com/langwatch/scenario/issues/371 https://github.com/langwatch/scenario/issues/373 https://github.com/langwatch/scenario/issues/473 https://github.com/langwatch/scenario/issues/474 https://github.com/langwatch/scenario/issues/475 | verify and close | Capability matrix confirms Python LiveKit, Vapi, WebRTC, WebSocket ship. |
| TS parity behind Python | https://github.com/langwatch/scenario/issues/563 https://github.com/langwatch/scenario/issues/568 https://github.com/langwatch/scenario/issues/569 https://github.com/langwatch/scenario/issues/642 | blocked on https://github.com/langwatch/scenario/pull/857 and https://github.com/langwatch/scenario/pull/850 | TS still stubs LiveKit, Vapi, generic WebRTC with `PendingTransportError`. |
| Terminal vs transient stream errors | https://github.com/langwatch/scenario/issues/718 https://github.com/langwatch/scenario/issues/868 https://github.com/langwatch/scenario/issues/869 https://github.com/langwatch/scenario/issues/870 | blocked on https://github.com/langwatch/scenario/pull/872 | Four issues, one PR. Close all four on merge. |
| Teardown wedge, same root cause | https://github.com/langwatch/scenario/issues/491 https://github.com/langwatch/scenario/issues/696 https://github.com/langwatch/scenario/issues/791 | verify and close | Fixed by https://github.com/langwatch/scenario/pull/694 and https://github.com/langwatch/scenario/pull/697. Close as duplicates of one another. |
| voiceStyle wiring, TS and Python pair | https://github.com/langwatch/scenario/issues/533 https://github.com/langwatch/scenario/issues/862 https://github.com/langwatch/scenario/issues/529 https://github.com/langwatch/scenario/issues/530 https://github.com/langwatch/scenario/issues/531 | blocked on https://github.com/langwatch/scenario/pull/863 and https://github.com/langwatch/scenario/pull/873 | 530 and 531 are duplicates. |
| STT span instrumentation | https://github.com/langwatch/scenario/issues/770 https://github.com/langwatch/scenario/issues/776 https://github.com/langwatch/scenario/issues/785 https://github.com/langwatch/scenario/issues/787 | 770, 776, 787 verify and close. 785 blocked on https://github.com/langwatch/scenario/pull/880 | 785 corrects 776. |
| Live production tracing of realtime apps | https://github.com/langwatch/scenario/issues/674 https://github.com/langwatch/scenario/issues/675 https://github.com/langwatch/scenario/issues/599 | needs spec | Belongs with platform SDK audio helpers (3968, 3969). 599 says trace export ships inline base64 audio in span attributes. |
| Hangup, drain, and lifecycle | https://github.com/langwatch/scenario/issues/839 https://github.com/langwatch/scenario/issues/756 https://github.com/langwatch/scenario/issues/763 https://github.com/langwatch/scenario/issues/760 https://github.com/langwatch/scenario/issues/719 https://github.com/langwatch/scenario/issues/896 | blocked on https://github.com/langwatch/scenario/pull/851 https://github.com/langwatch/scenario/pull/701 https://github.com/langwatch/scenario/pull/907 https://github.com/langwatch/scenario/pull/973 | 719 is ship now. |
| Repo hygiene and CI | https://github.com/langwatch/scenario/issues/490 https://github.com/langwatch/scenario/issues/505 https://github.com/langwatch/scenario/issues/564 https://github.com/langwatch/scenario/issues/764 https://github.com/langwatch/scenario/issues/893 https://github.com/langwatch/scenario/issues/898 https://github.com/langwatch/scenario/issues/758 https://github.com/langwatch/scenario/issues/759 | mixed | 758 (ESM/CJS entry points) and 759 (no debug logging) are ship now. |
| Shipped feature work, close | https://github.com/langwatch/scenario/issues/454 https://github.com/langwatch/scenario/issues/464 https://github.com/langwatch/scenario/issues/570 https://github.com/langwatch/scenario/issues/578 https://github.com/langwatch/scenario/issues/579 https://github.com/langwatch/scenario/issues/582 https://github.com/langwatch/scenario/issues/583 https://github.com/langwatch/scenario/issues/585 https://github.com/langwatch/scenario/issues/623 https://github.com/langwatch/scenario/issues/640 https://github.com/langwatch/scenario/issues/644 https://github.com/langwatch/scenario/issues/663 https://github.com/langwatch/scenario/issues/681 https://github.com/langwatch/scenario/issues/706 https://github.com/langwatch/scenario/issues/711 https://github.com/langwatch/scenario/issues/715 https://github.com/langwatch/scenario/issues/727 https://github.com/langwatch/scenario/issues/737 https://github.com/langwatch/scenario/issues/749 https://github.com/langwatch/scenario/issues/792 https://github.com/langwatch/scenario/issues/838 | verify and close | 578 and 579 have follow-up PRs open (964, 950). |
| Needs a decision | https://github.com/langwatch/scenario/issues/370 https://github.com/langwatch/scenario/issues/444 https://github.com/langwatch/scenario/issues/523 https://github.com/langwatch/scenario/issues/615 https://github.com/langwatch/scenario/issues/726 https://github.com/langwatch/scenario/issues/762 https://github.com/langwatch/scenario/issues/769 | needs spec | 370 is the voice epic. 615 is a mechanical deprecation, ship now. 762 (Twilio outbound to external numbers) is a real customer-shaped gap. |
| Stale | https://github.com/langwatch/scenario/issues/453 https://github.com/langwatch/scenario/issues/584 https://github.com/langwatch/scenario/issues/566 | 453 and 584 close. 566 ship now | 566: docs voice pages have no TypeScript tabs. |

### 2.4 Counts

| Bucket | Count |
|---|---|
| verify and close | 48 |
| ship now | 27 |
| blocked on an open PR | 23 |
| needs spec | 9 |
| stale close | 2 |

Excluded as false positives after body review: 23 hits (leadership call transcripts, SEO content, unrelated "realtime" UI streaming).

---

## 3. Feature completeness

### 3.1 Platform (`langwatch/langwatch` @ `8b51631777`)

| Surface | Status | Evidence |
|---|---|---|
| Trace viewer audio playback | Exists | `platform/app/src/shared/audio/pcmToWav.ts` wraps pcm16 and decodes g711. Extraction in `platform/app/src/server/stored-objects/`. |
| Media externalization at ingest | Exists | `specs/trace-processing/trace-media-blob-extraction.feature`, 20 scenarios. Stringified content arrays are parsed back via `coerce-content-to-array.ts`. |
| Simulation run voice playback | Exists | `platform/app/src/components/simulations/useSequentialAudioPlayback.ts`. Side-bubbles layout drops recordings, one `@unimplemented`. |
| Audio cost tracking | Exists | `spend-rating.service.ts` passes audio tokens, characters and seconds. Bug 6934 fixed. |
| Gateway REST audio (speech, transcriptions) | Exists | OpenAI and ElevenLabs, `services/aigateway/adapters/providers/`. |
| Gateway realtime session broker | Exists | ADR-097 amendment, PR 7066. Mint, book spend, confirm at close, write a span. |
| Gateway realtime media relay | Absent | No websocket or Hijacker code in `services/aigateway`. ADR-097 lists four unmet gates. Two `@unimplemented` scenarios: mid-call budget kill, tool-policy enforcement. |
| Scenario voice e2e through gateway | Absent | `specs/ai-gateway/audio-endpoints.feature:245` `@unimplemented`. Issue 6180. |
| Audio evaluators (langevals) | Absent | No audio quality, WER, or latency evaluator. |
| Langy voice I/O | Absent | No mic, STT or TTS code. |
| Optimization studio audio node | Absent | |
| SDK audio helpers (py, ts, go) | Partial | Generated OpenAPI types only. No content-part builders, no realtime instrumentors. Issues 3968, 3969. |
| Docs | Exists | `docs/agent-testing/voice-agents.mdx`, `docs/ai-gateway/api/{audio,realtime}.mdx`, capturing-audio tutorials. |
| feature-map.json | Partial | One generic multimodal-eval line. |
| Storage limits | Exists | Generic 50 MB nested-JSON cap. No audio-specific limit. |

### 3.2 Scenario SDK (`langwatch/scenario` @ `ae0c921c`)

| Capability | Python | JavaScript |
|---|---|---|
| OpenAI Realtime, ElevenLabs, Twilio, Pipecat (WS), Gemini Live, Composable, WebSocket | Ships | Ships |
| LiveKit, Vapi, generic WebRTC | Ships | Stub (`PendingTransportError`), issue 563 |
| Mint sessions through voice gateway | Ships (2026-08-22) | Ships (2026-08-22) |
| Voice OTEL spans (`voice.turn`, `voice.audio.*`, `voice.stt.transcribe`) | Ships | Ships |
| Per-run recording, timeline, latency metrics | Computed, local WAV only | Same |
| Audio reaching the platform | Per-message `input_audio` parts in `SCENARIO_MESSAGE_SNAPSHOT` | Same |
| Run-level audio, timeline or latency on `SCENARIO_RUN_FINISHED` | Absent | Absent |
| Specs | 15 voice feature files, zero `@unimplemented` | |
| Examples | 33 files | 6 tests |
| Docs | 21 pages, no dead links. No TS tabs (issue 566). | |

Correction to a researcher claim: Python still JSON-stringifies structured content before sending, but the platform parses it back before media extraction, and issue 494 is closed. Python voice runs do render audio today.

### 3.3 Top gaps, ranked by user impact

1. Run-level voice artifacts never reach the platform. No waveform, timeline, interruption or latency view is possible without a new event field or type.
2. No mid-call governance in the gateway. Budget and tool policy stop at session mint.
3. No audio evaluators. Voice runs get text-judge verdicts only.
4. No SDK audio helpers for production tracing of realtime apps. Issues 3968, 3969, 674, 599.
5. Self-hosted audio storage rough edges. Presigned URLs, CORS, Azure, hard-reject without a backend (3964, 494, 796, 799).
6. Playback bugs. Seek does not work (5582), transcript truncation (5539), side-bubbles drops recordings.
7. JS SDK adapter parity (563) and docs TS tabs (566).
8. Langy is text-only.

---

## 4. Draft user stories: voice through the app

Format: As a [persona], I want [outcome], so that [value]. Acceptance criteria are draft. Each story names the gap it closes and the issues it would close or depend on.

### Persona A: developer instrumenting a production voice agent

**A1. Trace a live realtime call with one helper.**
As a developer running an OpenAI Realtime or ElevenLabs agent in production, I want a one-line SDK helper that opens a LangWatch trace per call and attaches each audio turn, so that I can see every call in the trace explorer without writing OTEL by hand.
Acceptance: Python and TS helper. Audio stored via stored-objects, not inline base64 in span attributes. Cost attributed per turn.
Closes: https://github.com/langwatch/langwatch/issues/3968 https://github.com/langwatch/langwatch/issues/3969 https://github.com/langwatch/scenario/issues/674 https://github.com/langwatch/scenario/issues/599. Depends on https://github.com/langwatch/langwatch/issues/3964.

**A2. Play any call back in the trace view.**
As a developer, I want every audio turn in a trace to play inline with a working seek bar and correct transcript, so that I can debug a bad call from the UI alone.
Acceptance: seek works, transcript not truncated, recordings survive layout switch.
Closes: https://github.com/langwatch/langwatch/issues/5582 https://github.com/langwatch/langwatch/issues/5539, the side-bubbles `@unimplemented` scenario.

**A3. Route realtime sessions through the gateway with a virtual key.**
As a developer, I want to mint realtime sessions via the AI Gateway with my virtual key, so that spend, tracing and provider credentials are managed centrally.
Status: shipped (ADR-097 broker). Story exists to document the current path and confirm docs cover it.

**A4. Have a call cut off when budget is exhausted.**
As a platform admin, I want a realtime session terminated mid-call when its virtual key budget runs out, so that a runaway agent cannot overspend.
Depends on the ADR-097 media relay, four gates unmet. Needs spec. Closes the two `@unimplemented` scenarios in `specs/ai-gateway/realtime-sessions.feature`.

### Persona B: QA or AI engineer running voice scenarios

**B1. See the whole call, not per-turn clips.**
As a QA engineer reviewing a voice scenario run, I want to play the full conversation as one continuous recording with a turn timeline, so that I can hear interruptions and pauses in context.
Acceptance: single player, turn markers, click a marker to seek.
Related: https://github.com/langwatch/langwatch/issues/4627 (Phase A parked), https://github.com/langwatch/scenario/issues/585.

**B2. See latency and interruption metrics per run.**
As an AI engineer, I want each voice scenario run to show time-to-first-audio, turn latency, interruption count and barge-in recovery, so that I can catch regressions in responsiveness, not just in wording.
Requires: new fields or event type carrying `ScenarioResult.timeline` and `.latency` from the SDK to the platform. Needs spec. This is gap 1.

**B3. Judge voice runs on audio, not only transcript.**
As an AI engineer, I want built-in evaluators for transcription accuracy, speech latency and silence gaps, so that voice quality is scored automatically.
Requires: audio evaluators in langevals. Needs spec. This is gap 3.

**B4. Author a voice scenario in the UI with an uploaded recording.**
As a QA engineer, I want to upload a real customer call recording when authoring a scenario in the app, so that the simulated user reproduces a real complaint.
Related: https://github.com/langwatch/langwatch/issues/6283 https://github.com/langwatch/langwatch/issues/3965.

**B5. Run voice scenarios end to end through the gateway in CI.**
As a maintainer, I want the scenario voice suite to run against gateway audio endpoints in CI, so that a gateway change cannot silently break voice testing.
Closes: https://github.com/langwatch/langwatch/issues/6180.

**B6. Use every adapter from TypeScript.**
As a TS developer, I want LiveKit, Vapi and WebRTC adapters with real transports and TS tabs in the voice docs, so that I am not pushed to Python.
Closes: https://github.com/langwatch/scenario/issues/563 https://github.com/langwatch/scenario/issues/566.

### Persona C: product or engineering lead

**C1. See voice cost and volume per project.**
As a lead, I want audio seconds, characters and realtime tokens broken out in cost views, so that I know what voice costs versus text.
Status: pricing exists in the spend rater. Needs a UI breakdown. Verify https://github.com/langwatch/langwatch/issues/7048 shipped.

**C2. Self-host voice with my own object store.**
As a self-hosted admin, I want audio to work on S3 with CORS, or Azure Blob, and to get a clear error rather than a dropped event when no store is configured, so that voice adoption does not depend on SaaS.
Closes: https://github.com/langwatch/langwatch-saas/issues/494 https://github.com/langwatch/langwatch-saas/issues/796 https://github.com/langwatch/langwatch-saas/issues/799.

**C3. Find voice features in the product.**
As a new user, I want voice testing, the realtime gateway and audio playback listed as features, so that I discover them.
Closes: feature-map.json gap. Small.

### Persona D: any user talking to Langy

**D1. Talk to Langy.**
As a user, I want to speak a question to Langy and hear the answer, so that I can use LangWatch hands-free while reviewing runs.
Status: zero groundwork. Explicitly out of scope until A and B stories land. Recorded so the option is not lost.

### Suggested order

1. A1, A2, C2 (unblocks customers and self-hosted; closes the largest cluster of open platform issues).
2. B1, B2 (the "voice through the app" core; needs one SDK event change and one UI).
3. B5, B6, C1, C3 (hygiene and discoverability).
4. B3, A4 (require new evaluator and relay architecture; spec first).
5. D1 (later).

---

## 5. Next actions

- Merge or land https://github.com/langwatch/langwatch/pull/7830 for the credential leak.
- Unblock https://github.com/langwatch/scenario/issues/882 so JS CI is green.
- Owner sweep of the 48 verify-and-close issues in the scenario repo, 30 seconds each.
- Add a `voice` label in `langwatch/langwatch` and `langwatch/scenario` so this survey does not need 23 search terms next time.
- Spec B2 (run-level voice artifacts on the platform). It unlocks the most visible voice UI work.
