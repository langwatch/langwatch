# Voice: open-issue triage, feature completeness, and draft user stories

Date: 2026-09-07
Sources: `langwatch/langwatch` @ `8b51631777`, `langwatch/scenario` @ `ae0c921c` (both latest `main`), GitHub open issues across the `langwatch` org.
Status: research document, second pass. On 2026-09-07, 17 scenario issues verified as delivered were closed with a comment naming the delivering PR. Nothing was created or labeled. Any issue filing should go through `/create-issue`.

---

## 1. Headline

- **90 open voice/audio issues** across the org after this pass, down from 107. Scenario SDK 63, platform 19, langwatch-saas 6, two elsewhere. None carry a `voice` or `audio` label, in any repo.
- **17 closed as verified delivered, 31 "looked done" ones are not.** Of 48 issues that referenced a merged PR, only 17 survived a code check. The cross-reference signal is mostly dependency bumps. Details in 2.3.
- **The product story is a phone call from the app.** A QA lead registers the agent's phone number, describes the caller, presses Call, and reviews the call. The platform already has a server-side scenario runner and per-turn audio rendering. Missing: a phone target type, Twilio credentials, a media ingress, a long-lived call session, run-level audio and latency, and above all the ability to dial a number outside your own Twilio account (scenario 762). Section 4.
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
| https://github.com/langwatch/langwatch/issues/1727 | EPIC: multimodal traces, images and audio in S3 | keep open, partial | Audio storage shipped by a different design (https://github.com/langwatch/langwatch/pull/5949, https://github.com/langwatch/langwatch/pull/5307). Five children (3964-3969) still open, checklist unchecked, image sub-tree unfiled. |
| https://github.com/langwatch/langwatch/issues/1763 | PROPOSAL: Voice Agent API design | needs spec | Superseded in part by ADR-097 realtime broker. Decide keep or close. |
| https://github.com/langwatch/langwatch/issues/3964 | Presigned PUT+GET endpoints for audio assets | ship now | P1. Prereq for SDK upload helpers. |
| https://github.com/langwatch/langwatch/issues/3965 | ScenarioMessageRenderer fetches audio via presigned GET | ship now | Depends on 3964. |
| https://github.com/langwatch/langwatch/issues/3966 | Docs: audio storage end to end | ship now | After 3964/3965. |
| https://github.com/langwatch/langwatch/issues/3968 | Python SDK audio upload helper | ship now | Depends on 3964. Matches gap "no SDK audio helpers". |
| https://github.com/langwatch/langwatch/issues/3969 | TS SDK audio upload helper | ship now | Same. |
| https://github.com/langwatch/langwatch/issues/4157 | Sim run UI: image messages lack View Trace | keep open, partial | Turn separator now opens the trace drawer per turn in full view. Image case still has no affordance in compact view. Decision never recorded on the issue. |
| https://github.com/langwatch/langwatch/issues/4627 | Play whole voice conversation as one recording | partial, verify | Sequential playback shipped. Last comment says Phase A is parked on branch `feat/4627-conversation-sequential-audio`. |
| https://github.com/langwatch/langwatch/issues/4715 | Extractor does not externalize bytes in tool-call args | ship now | Confirmed unfixed on main. `content-extractor.ts:100` no-ops tool calls and scenario ingest never walks top-level `tool_calls`. The trace-span walker would catch it, scenario events do not use it. |
| https://github.com/langwatch/langwatch/issues/4915 | Datasets: image cells through StoredObjectsService | ship now | Adjacent, not voice. |
| https://github.com/langwatch/langwatch/issues/5313 | Play all raw-PCM realtime formats inline | keep open, partial | G.711 ulaw and alaw done. Non-24kHz pcm16 not done: `pcmToWav.ts` hardcodes 24000 and discards any rate hint, so 8k or 16k audio plays at the wrong pitch. Matters for Twilio, which is 8k. |
| https://github.com/langwatch/langwatch/issues/5539 | Scenario UI conversation view truncates transcription | ship now | P2, size XS. |
| https://github.com/langwatch/langwatch/issues/5582 | Simulations audio player seek does not work | needs spec | Likely blob served without range support. Quick investigation. |
| https://github.com/langwatch/langwatch/issues/6180 | Automate Scenario voice e2e against gateway audio endpoints | ship now | P1. Matches the one `@unimplemented` in `specs/ai-gateway/audio-endpoints.feature`. |
| https://github.com/langwatch/langwatch/issues/6283 | Attach a file to a scenario when authoring in UI | needs spec | Enabler for "upload a call recording" stories below. |
| https://github.com/langwatch/langwatch/issues/6290 | Gateway translated lanes drop valid params incl. audio | keep open, partial | https://github.com/langwatch/langwatch/pull/6318 made the `audio` and `modalities` params a visible drop. `input_audio` message content still silently drops on the Anthropic lane and VPCE media parts still vanish, per the author's own follow-up comment. |
| https://github.com/langwatch/langwatch/issues/7048 | Cached audio tokens price as fresh | blocked, keep open | Not delivered. https://github.com/langwatch/langwatch/pull/7021 added fresh audio quantities only. No cached-audio field exists anywhere in the repo. Still waiting on a Bifrost upgrade. |
| https://github.com/langwatch/langwatch-saas/issues/494 | CORS on dataplane S3 buckets for audio | ship now | Prereq for presigned GET in browser. |
| https://github.com/langwatch/langwatch-saas/issues/796 | Azure blob as stored-objects write destination | ship now | Self-hosted voice customers on Azure. |
| https://github.com/langwatch/langwatch-saas/issues/799 | Media attachments hard-reject the whole scenario event without a stored-objects backend | ship now | P2. Silent data loss for self-hosted. |
| https://github.com/langwatch/langwatch-saas/issues/969 | CO3 outbound voice customer needs commercial owner | needs spec | Commercial, not engineering. |
| https://github.com/langwatch/tasks/issues/95 | Typecheck drift in voice-factories tests | ship now | Small. |
| https://github.com/langwatch/ai-interviewer-scenario-demo/issues/2 | Judge side-channel leaks as raw JSON bubble | needs spec | Demo repo. |

### 2.3 Scenario SDK (63 open after this pass) by cluster

On 2026-09-07 every "referenced by a merged PR" candidate was verified against code on main, and 17 were closed with a comment naming the delivering PR and the verified commit. The GitHub cross-reference signal turned out to be mostly noise: for the adapter-transport group every cited PR was a dependency bump or an unmerged branch. Buckets below reflect the verified state.

**Closed 2026-09-07 (17):** https://github.com/langwatch/scenario/issues/362 https://github.com/langwatch/scenario/issues/454 https://github.com/langwatch/scenario/issues/491 https://github.com/langwatch/scenario/issues/582 https://github.com/langwatch/scenario/issues/584 https://github.com/langwatch/scenario/issues/585 https://github.com/langwatch/scenario/issues/696 https://github.com/langwatch/scenario/issues/706 https://github.com/langwatch/scenario/issues/711 https://github.com/langwatch/scenario/issues/715 https://github.com/langwatch/scenario/issues/727 https://github.com/langwatch/scenario/issues/737 https://github.com/langwatch/scenario/issues/770 https://github.com/langwatch/scenario/issues/776 https://github.com/langwatch/scenario/issues/791 https://github.com/langwatch/scenario/issues/838 https://github.com/langwatch/scenario/issues/893

| Cluster | Issues | Bucket | Verified state |
|---|---|---|---|
| Adapter transports still stubs | https://github.com/langwatch/scenario/issues/356 https://github.com/langwatch/scenario/issues/358 https://github.com/langwatch/scenario/issues/361 https://github.com/langwatch/scenario/issues/363 https://github.com/langwatch/scenario/issues/371 https://github.com/langwatch/scenario/issues/373 https://github.com/langwatch/scenario/issues/473 https://github.com/langwatch/scenario/issues/474 https://github.com/langwatch/scenario/issues/475 | needs spec, real gap | LiveKit, Vapi, generic WebRTC and Pipecat WebRTC mode raise `PendingTransportError` in Python and TypeScript. Only WebSocket (362, closed) shipped. Capability matrix rows 89-94 say so. No traceability map exists (373). |
| TS parity behind Python | https://github.com/langwatch/scenario/issues/563 https://github.com/langwatch/scenario/issues/568 https://github.com/langwatch/scenario/issues/569 https://github.com/langwatch/scenario/issues/642 | 569 blocked on https://github.com/langwatch/scenario/pull/850, rest ship now | 563 is smaller than it looks: the "Python-only" adapters are stubs in Python too. |
| Terminal vs transient stream errors | https://github.com/langwatch/scenario/issues/718 https://github.com/langwatch/scenario/issues/868 https://github.com/langwatch/scenario/issues/869 https://github.com/langwatch/scenario/issues/870 | blocked on https://github.com/langwatch/scenario/pull/872 | Four issues, one draft PR the author calls ready. Undraft and review. |
| voiceStyle wiring | https://github.com/langwatch/scenario/issues/533 https://github.com/langwatch/scenario/issues/862 https://github.com/langwatch/scenario/issues/529 https://github.com/langwatch/scenario/issues/530 https://github.com/langwatch/scenario/issues/531 | 533, 862 blocked on https://github.com/langwatch/scenario/pull/863. 529, 530, 531 ship now | 530 and 531 have distinct scope, not duplicates. Neither is done. |
| STT hardening | https://github.com/langwatch/scenario/issues/785 https://github.com/langwatch/scenario/issues/787 | 785 blocked on https://github.com/langwatch/scenario/pull/880. 787 ship now | 787: three providers still lack sanitize-before-STT. |
| Live production tracing of realtime apps | https://github.com/langwatch/scenario/issues/674 https://github.com/langwatch/scenario/issues/675 https://github.com/langwatch/scenario/issues/599 | needs spec | Belongs with platform SDK audio helpers (3968, 3969). |
| Hangup, drain, lifecycle | https://github.com/langwatch/scenario/issues/839 https://github.com/langwatch/scenario/issues/756 https://github.com/langwatch/scenario/issues/763 https://github.com/langwatch/scenario/issues/760 https://github.com/langwatch/scenario/issues/719 https://github.com/langwatch/scenario/issues/896 https://github.com/langwatch/scenario/issues/792 | blocked on https://github.com/langwatch/scenario/pull/851 https://github.com/langwatch/scenario/pull/701 https://github.com/langwatch/scenario/pull/907 https://github.com/langwatch/scenario/pull/973 | 719 and 792 ship now. 792 is still flagged live in a code comment in the OpenAI realtime adapter. |
| Repo hygiene and CI | https://github.com/langwatch/scenario/issues/490 https://github.com/langwatch/scenario/issues/505 https://github.com/langwatch/scenario/issues/564 https://github.com/langwatch/scenario/issues/764 https://github.com/langwatch/scenario/issues/898 https://github.com/langwatch/scenario/issues/758 https://github.com/langwatch/scenario/issues/759 https://github.com/langwatch/scenario/issues/882 https://github.com/langwatch/scenario/issues/854 | mixed | 882 P1 and 854 need an owner this week. 564 blocked on https://github.com/langwatch/scenario/pull/840. 505 (LFS) not done. |
| Partially shipped, remainder is real work | https://github.com/langwatch/scenario/issues/464 https://github.com/langwatch/scenario/issues/570 https://github.com/langwatch/scenario/issues/578 https://github.com/langwatch/scenario/issues/579 https://github.com/langwatch/scenario/issues/583 https://github.com/langwatch/scenario/issues/623 https://github.com/langwatch/scenario/issues/640 https://github.com/langwatch/scenario/issues/644 https://github.com/langwatch/scenario/issues/663 https://github.com/langwatch/scenario/issues/681 https://github.com/langwatch/scenario/issues/749 | ship now, 578 and 579 blocked on https://github.com/langwatch/scenario/pull/964 and https://github.com/langwatch/scenario/pull/950 | 464 (DTMF IVR bot) matters for the phone-call story in section 4. 623 headline ask (agent speaks first) still absent. |
| Needs a decision | https://github.com/langwatch/scenario/issues/370 https://github.com/langwatch/scenario/issues/444 https://github.com/langwatch/scenario/issues/523 https://github.com/langwatch/scenario/issues/615 https://github.com/langwatch/scenario/issues/726 https://github.com/langwatch/scenario/issues/762 https://github.com/langwatch/scenario/issues/769 | needs spec | 370 is the voice epic. 615 is a mechanical deprecation, ship now. 762 (Twilio A-leg to external numbers) is the critical path for section 4. |
| Stale | https://github.com/langwatch/scenario/issues/453 https://github.com/langwatch/scenario/issues/566 | 453 close after a human checks the Notion board. 566 ship now | 566: docs voice pages have no TypeScript tabs. |

### 2.4 Counts after this pass

| | Before | Closed 2026-09-07 | Open now |
|---|---|---|---|
| scenario | 80 | 17 | 63 |
| langwatch | 19 | 0 | 19 |
| langwatch-saas | 6 | 0 | 6 |
| other | 2 | 0 | 2 |
| Total | 107 | 17 | 90 |

Of the 48 issues that looked "already shipped" by PR cross-reference, 17 were. The other 31 are partial or untouched. Two more (scenario 453, langwatch 4157) need a human call rather than a code check.

Open buckets now: ship now 42, blocked on an open PR 23, needs spec 21, keep open partial 4.

Excluded as false positives after body review: 23 hits (leadership call transcripts, SEO content, unrelated "realtime" UI streaming).


### 2.5 Open PRs that block voice issues (checked 2026-09-07)

None of the fifteen is one click from merge. None is stale by the 30-day rule. One has failing CI, one has merge conflicts.

| PR | What it is | Unblocks | State | What blocks merge |
|---|---|---|---|---|
| https://github.com/langwatch/scenario/pull/873 | Security: close 117 JS dependency alerts | scenario 490, 529, 531, 533, 882 | CI green, review required | Awaiting human review. Three CodeRabbit items. Only indirectly voice: it unblocks the JS CI lane. |
| https://github.com/langwatch/scenario/pull/872 | Surface a dead Gemini Live session instead of hanging | scenario 718, 868, 869, 870 | CI green, still draft | Author says ready. Needs undraft and a reviewer. Best ratio of issues closed per review. |
| https://github.com/langwatch/scenario/pull/857 | Security: close alerts on python uv.lock | scenario 563, 568, 882 | CI green, review required | Automation approval was dismissed. Needs a human review. Indirect, same as 873. |
| https://github.com/langwatch/scenario/pull/851 | Propagate hard tail receive errors | scenario 756, 839 | Merge conflicts | Needs rebase before review. |
| https://github.com/langwatch/scenario/pull/863 | Wire voiceStyle through synthesize to TTS providers | scenario 533, 862 | Changes requested | Screenshots committed into the repo instead of the screenshots repo. Mechanical fix. |
| https://github.com/langwatch/scenario/pull/701 | OpenCode agent adapter | scenario 763 | Changes requested since June | Unresolved "missing await" thread. Oldest open PR in the set. |
| https://github.com/langwatch/scenario/pull/840 | Stop Pipecat bot process cleanly | scenario 564 | Changes requested | Regression test not wired into CI. Author claims fixed, awaiting re-review. |
| https://github.com/langwatch/scenario/pull/850 | Ignore empty first chunk for speaking event | scenario 569 | Changes requested | One P1 correctness finding unresolved. |
| https://github.com/langwatch/scenario/pull/880 | Instrument judge STT pre-pass | scenario 785 | Changes requested, CI not run on latest SHA | Debug log leaks raw provider exception. Missing JS parity test. |
| https://github.com/langwatch/langwatch/pull/6777 | Restore ragas evaluators, close 18 alerts | scenario 882 (indirect) | CI failing | One failing check plus two review findings on migration and test coverage. |
| https://github.com/langwatch/scenario/pull/907 | Discard interrupted Gemini turn residue | scenario 760 | CI green, review required | Clean. Needs a reviewer. |
| https://github.com/langwatch/scenario/pull/950 | Drop agent-shapes re-export shim | scenario 579 | CI green, review required | One CodeRabbit item. Needs a reviewer. |
| https://github.com/langwatch/scenario/pull/964 | Clear sampled barge-in delay on every skip path | scenario 578 | Changes requested | One unresolved inline finding. |
| https://github.com/langwatch/langwatch/pull/7830 | Drop xi-api-key header on Gemini passthrough | langwatch 7825 (security) | CI green, no review yet | Four days old, no reviewer assigned. Should be first in the queue. |
| https://github.com/langwatch/scenario/pull/973 | Resolve voice providers per run | scenario 896 | CI green, review required | New. Three CodeRabbit items. |

Reviewer queue that pays back fastest: 7830 (security), 872 (undraft, four issues), 907, 950, 973 (all clean), then 863 (move screenshots), then 851 (rebase).

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
| LiveKit, Vapi, generic WebRTC, Pipecat WebRTC mode | Stub (`PendingTransportError`), issues 356, 358, 361, 363 | Stub, issue 563 |
| Twilio outbound to a number you own | Ships | Ships |
| Twilio outbound to an external number (a real agent's line) | Absent, issue 762 | Absent |
| Mint sessions through voice gateway | Ships (2026-08-22) | Ships (2026-08-22) |
| Voice OTEL spans (`voice.turn`, `voice.audio.*`, `voice.stt.transcribe`) | Ships | Ships |
| Per-run recording, timeline, latency metrics | Computed, local WAV only | Same |
| Audio reaching the platform | Per-message `input_audio` parts in `SCENARIO_MESSAGE_SNAPSHOT` | Same |
| Run-level audio, timeline or latency on `SCENARIO_RUN_FINISHED` | Absent | Absent |
| Specs | 15 voice feature files, zero `@unimplemented` | |
| Examples | 33 files | 6 tests |
| Docs | 21 pages, no dead links. No TS tabs (issue 566). | |

Correction to an earlier version of this document: LiveKit, Vapi and generic WebRTC were listed as shipping in Python. They are stubs in both languages, verified in the adapter sources and the capability matrix on 2026-09-07.

Correction to a researcher claim: Python still JSON-stringifies structured content before sending, but the platform parses it back before media extraction, and issue 494 is closed. Python voice runs do render audio today.

### 3.3 Top gaps, ranked by user impact

1. Run-level voice artifacts never reach the platform. No waveform, timeline, interruption or latency view is possible without a new event field or type.
2. No mid-call governance in the gateway. Budget and tool policy stop at session mint.
3. No audio evaluators. Voice runs get text-judge verdicts only.
4. No SDK audio helpers for production tracing of realtime apps. Issues 3968, 3969, 674, 599.
5. Self-hosted audio storage rough edges. Presigned URLs, CORS, Azure, hard-reject without a backend (3964, 494, 796, 799).
6. Playback bugs. Seek does not work (5582), transcript truncation (5539), side-bubbles drops recordings.
7. No way to call an agent's real phone number. Twilio adapter only dials numbers in your own account (762). Blocks the platform phone-call story in section 4.
8. LiveKit, Vapi and WebRTC adapters are stubs in both languages. Docs have no TS tabs (566).
9. Langy is text-only.

---

## 4. User stories: black-box phone-call testing from the platform

### 4.1 The story in one paragraph

A QA lead or AI product owner has a voice agent live on a phone number. They open LangWatch, register that number as a test target, describe the caller they want to simulate and what a good call looks like, and press Call. The platform dials the agent over Twilio, a simulated caller talks to it, and the finished call appears in the app with recording, transcript, verdict, latency and cost. No SDK, no local code, no tunnel.

### 4.2 What exists today, what is missing

| Building block | Status | Evidence |
|---|---|---|
| Server-side scenario runner in the platform | Exists | `platform/app/src/server/scenarios/execution/execution-pool.ts`. Event-driven queue, child processes, concurrency 3 per pod. |
| Target types the runner can drive | Exists, no voice | `platform/app/src/server/scenarios/simulation-target.ts:11-14`: `prompt`, `http`, `code`, `workflow`, `connected`. No `phone` or `voice`. |
| SDK Twilio adapter placing a real call | Partial | `python/scenario/voice/adapters/twilio.py:66-90` calls Twilio REST `calls.create`, but attaches media by rewriting the callee's webhook, so the callee must be a number in your own Twilio account. |
| Dialing an arbitrary external number (the agent's real line) | Absent | https://github.com/langwatch/scenario/issues/762. Needs A-leg `<Connect><Stream>` on the originated leg. Pulled back to backlog, no written plan, nine named safety gaps. |
| Twilio credentials in the platform | Absent | No Twilio, SIP or telephony code anywhere in `platform/`, `services/`, `specs/`. Generic encrypted `ModelProvider.customKeys` already hosts ElevenLabs credentials and could hold Twilio SID and token. |
| Public media-stream ingress | Absent | SDK needs `public_base_url` and spins up a cloudflared tunnel. Platform has no websocket ingress for Twilio media. |
| Long-lived call session runner | Absent | Existing pool is short-lived batch child processes, not held call sessions with inbound webhooks. |
| Review UI: per-turn audio, transcript, verdict, criteria | Exists | `MediaPart.tsx`, `RunCriteriaChip.tsx`, `CriteriaDetails.tsx`. |
| Review UI: whole-call recording, timeline, latency, interruptions | Absent | SDK computes `ScenarioResult.audio`, `.timeline`, `.latency` (`scenario_executor.py:998-1030`) and never sends them (`scenario_executor.py:2088-2115`). `MetricsSummary.tsx` shows only run duration. |
| Docs | Over-promise | `docs/agent-testing/voice-agents.mdx` advertises per-turn TTFB and p50/p95 latency. The app never receives it. |

### 4.3 Stories

Persona: **Maya, QA lead** for a company whose support agent answers a phone number. She does not write code. Secondary persona: **Dev, the agent's engineer**, who instruments the agent and reads traces.

**P1. Register my agent's phone number as a test target.**
As Maya, I want to add a phone number as a scenario target, so that every voice scenario in the project can be run against the live agent.
Accept: new target type `phone` next to prompt, http, code, workflow, connected. Fields: number in E.164, label, country, allowed calling hours, optional IVR path. Number must be verified once (a call that reads a code, or an allowlist set by an admin) before it can be dialed.
Requires: `SimulationTarget` type extension, destination allowlist (safety gap named in scenario 762).

**P2. Connect Twilio to my project.**
As a project admin, I want to store Twilio account SID, auth token and the caller number LangWatch dials from, so that calls are placed from our own account and billed to us.
Accept: stored encrypted in the same provider-credential store used for ElevenLabs. Test button places a call to the caller number itself. Option for a LangWatch-provided number on cloud so a trial user needs no Twilio account.
Requires: Twilio entry in the provider credential model.

**P3. Describe the caller and what a good call looks like.**
As Maya, I want to author the simulated caller in the UI: who they are, what they want, how they speak (voice, pace, accent, background noise), and the pass criteria, so that the test reflects a real customer.
Accept: reuses the existing scenario authoring form. Adds voice style, background noise preset and language. Criteria are judged on the transcript, with audio metrics as thresholds (see P6).
Requires: voice style wiring (scenario 533, 862) exposed as UI fields.

**P4. Press Call and watch it happen.**
As Maya, I want to press Call in the app and see the call progress live: dialing, ringing, answered, caller speaking, agent speaking, hung up, so that I know the test is working without waiting for the end.
Accept: the platform originates the call from the caller number to the target number, attaches a media stream on the originated leg, and streams turn events into the existing simulation console. Hard stop at a max duration. Cancel button hangs up.
Requires: A-leg `<Connect><Stream>` topology (scenario 762), a websocket media ingress on the platform with a public URL, a long-lived call session in the runner, and the realtime or composable simulated user running server-side.

**P5. Keep me safe from calling the wrong number or running up a bill.**
As a project admin, I want destination allowlists, max call duration, per-call and per-day cost caps, calling-hours windows and a recorded consent line, so that a mistyped number or a runaway loop cannot cause harm.
Accept: a call outside the allowlist or window is refused before dialing. Cost cap uses the audio pricing already in the spend rater. Every call logs who started it.
Requires: the safety gaps enumerated in scenario 762 turned into platform policy. This is the story that decides whether the feature can ship.

**P6. Review the call as one recording with the numbers that matter.**
As Maya, I want to open the finished run and play the whole call as one recording with turn markers, read the transcript, see the verdict and criteria, and see time to first word, per-turn response latency, interruptions and silence gaps, so that I can tell wording problems from responsiveness problems.
Accept: single player with seek. Per-turn table of latency. Verdict and criteria as today. Cost of the call.
Requires: run-level audio, timeline and latency carried to the platform (new fields on run finished or a new event), plus the whole-call player (langwatch 4627, currently parked). Fixes seek (5582) and transcript truncation (5539) on the way.

**P7. Get through the IVR menu first.**
As Maya, I want the simulated caller to press keys or speak menu choices to reach the agent behind an IVR, so that I can test agents that sit behind a phone tree.
Accept: IVR path defined on the target as a sequence of DTMF digits or spoken phrases with waits. DTMF events appear on the timeline.
Requires: DTMF support already in the SDK (`dtmf_ivr` example, scenario 464 delivered) surfaced in the platform runner.

**P8. Run a batch of callers and compare over time.**
As Maya, I want to run a set of caller personas against the number on a schedule and see pass rate and latency trend per persona, so that I catch regressions after each agent deploy.
Accept: reuses scenario sets and scheduling. Trend chart of pass rate and p50 latency per set. Concurrency cap per project so a batch cannot flood the agent's line.
Requires: P4 and P6.

**P9. Link the call to the agent's own trace.**
As Dev, I want the call run to link to the trace my agent emitted for that call, so that I can jump from a failed criterion to the model calls and tool calls behind it.
Accept: match by Twilio call SID when the agent is instrumented with LangWatch, else by caller number and time window. View Trace button on each turn, as already exists for SDK voice runs.
Requires: SDK audio and realtime helpers (langwatch 3968, 3969, scenario 674) so the agent side emits call SID and audio.

**P10. Tell me why the call failed to connect.**
As Maya, I want a clear reason when the call did not happen: no answer, busy, voicemail, refused by allowlist, Twilio auth error, one-way audio, so that I fix the setup instead of guessing.
Accept: failure reasons are distinct statuses on the run, with the Twilio error code where there is one.
Requires: terminal-versus-transient error handling now being unified in scenario PR 872.

**P11. Bring my own Twilio on self-hosted.**
As a self-hosted admin, I want the same flow to work with our own Twilio account and our own object store, with the platform exposing the media ingress URL itself, so that no tunnel or cloud dependency is needed.
Accept: ingress URL derived from the platform's public base URL. Audio lands in S3 or Azure Blob. Clear error when no store is configured.
Requires: langwatch-saas 494, 796, 799.

### 4.4 Build order

1. **P2, P1, P5.** Credentials, target type, safety policy. Small, unblocks everything, and P5 decides whether the feature can ship at all.
2. **P4 with an account-owned number only.** Reuse today's SDK topology to get the server-side call session, media ingress and live console working before the A-leg risk. Dogfood on our own Twilio numbers.
3. **P6.** Run-level audio, timeline and latency to the platform. This also fixes the docs over-promise for SDK users and is worth doing even if the phone runner slips.
4. **P4 external numbers.** Scenario 762 A-leg topology. Needs a written plan first.
5. **P7, P10.** IVR and failure reasons.
6. **P8, P9, P11.** Batches, trace linkage, self-hosted.

### 4.5 Secondary stories, kept for the backlog

- Developer: one-line SDK helper to trace a live realtime call with audio stored out of band (langwatch 3968, 3969, scenario 674, 599).
- Platform admin: cut a gateway realtime session off when budget runs out (ADR-097 relay, four gates unmet).
- AI engineer: audio evaluators for transcription accuracy and silence gaps (langevals, absent).
- TS developer: LiveKit, Vapi and WebRTC adapters and TS docs tabs (scenario 563, 566).
- Lead: voice cost broken out per project (spend rater has the data).
- New user: voice features listed in the product feature map.
- Any user: talk to Langy. No groundwork, later.

## 5. Next actions

- Merge or land https://github.com/langwatch/langwatch/pull/7830 for the credential leak.
- Unblock https://github.com/langwatch/scenario/issues/882 so JS CI is green.
- Reviewer queue, in order: 7830, 872 (undraft), 907, 950, 973, 863, 851 (rebase). Section 2.5.
- Human call on scenario 453 (Notion board) and langwatch 4157 (record the decision on the issue).
- Add a `voice` label in `langwatch/langwatch` and `langwatch/scenario` so this survey does not need 23 search terms next time.
- Write the plan for scenario 762 (Twilio A-leg to external numbers). It is the critical path for section 4 and has none.
- Spec P6 (run-level audio, timeline, latency to the platform). Worth doing even if the phone runner slips, and it fixes the docs over-promise.
- Fix the docs claim in `docs/agent-testing/voice-agents.mdx` that the app shows per-turn TTFB and p50/p95. It does not.
