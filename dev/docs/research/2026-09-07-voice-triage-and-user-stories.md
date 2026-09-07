# Voice: open-issue triage, feature completeness, and draft user stories

Date: 2026-09-07
Sources: `langwatch/langwatch` @ `8b51631777`, `langwatch/scenario` @ `ae0c921c` (both latest `main`), GitHub open issues across the `langwatch` org.
Status: research document, second pass. On 2026-09-07, 17 scenario issues verified as delivered were closed with a comment naming the delivering PR. Nothing was created or labeled. Any issue filing should go through `/create-issue`.

---

## 1. Headline

- **90 open voice/audio issues** across the org after this pass, down from 107. Scenario SDK 63, platform 19, langwatch-saas 6, two elsewhere. None carry a `voice` or `audio` label, in any repo.
- **17 closed as verified delivered, 31 "looked done" ones are not.** Of 48 issues that referenced a merged PR, only 17 survived a code check. The cross-reference signal is mostly dependency bumps. Details in 2.3.
- **V1 is testing a voice agent from the app, with an ElevenLabs hosted agent as the baseline target.** A team pastes an agent id, talks to it from the browser, and has a simulated caller phone it in batches. Every call lands as a normal run with transcript, per-turn audio and verdict. Config is one API key in Settings and one agent id. The SDK adapter, the gateway signed-URL mint, the credential store, the agent model and the scenario model all exist. New work is one agent type, one drawer, one mic panel, one post-call fetch and pool wiring. Phone-number targets wait on scenario 762 and move to V2 on the same screens. Section 4.
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

## 4. V1: test a voice agent from the app, with an ElevenLabs agent as the baseline

### 4.1 V1 in one paragraph

V1 lets a team point LangWatch at a voice agent they already run on ElevenLabs Conversational AI, talk to it from the browser, and have a simulated caller phone it in batches, with every call landing as a normal run: transcript, per-turn audio, verdict and criteria. Total configuration is an ElevenLabs API key in Settings once and an agent id per agent. No Twilio, no phone number, no tunnel, no SDK install, no key on the agent. Phone-number targets, which need the A-leg media stream in scenario 762, move to V2 and reuse every screen below.

### 4.2 Why this is the right V1

- **It works today, end to end, at the SDK level.** The ElevenLabs adapter talks to a hosted agent by agent id over the ElevenLabs websocket (`python/scenario/voice/adapters/elevenlabs.py:240-252`). The whole agent pipeline runs on ElevenLabs. It is black box.
- **The gateway already does the hard part.** It mints the ElevenLabs signed URL (`GET /v1/convai/conversation/get-signed-url`, `services/aigateway/adapters/httpapi/router.go:193`), records the conversation id at mint time, receives the post-call webhook (`router.go:171`) and reconciles unclosed sessions by polling the conversation (`platform/app/src/server/gateway/realtimeSessionPoller.ts`). Spend is already tracked. Only the transcript and recording fetch are missing.
- **The credential store exists.** The ElevenLabs provider row in Settings already holds the API key, base URL and webhook secret (`platform/app/src/server/modelProviders/registry.ts:530-545`).
- **The agent model fits.** An agent is one row with a type string and a JSON config (`platform/app/prisma/schema.prisma:2800`). A Voice agent is a new type value and a config variant, not a new table.
- **The scenario model fits.** In the SDK a voice scenario is the same run as a text scenario with a `voice` argument on the user simulator (`python/scenario/user_simulator_agent.py:225`). Only three caller-side knobs are voice-only: voice, interrupt probability, audio effects. All have defaults.
- **Phone is not needed to prove the product.** For an ElevenLabs agent that also has a Twilio number, the websocket path covers everything that changes when someone edits the prompt, the tools or the voice. The telephony leg is a V2 concern.

What V1 does not cover: agents on Vapi, Retell, LiveKit, Pipecat, in-house stacks, or reachable only by phone number. Those wait on 762 or on the SDK adapters that are stubs today (3.2).

Re-verified on scenario main `ae0c921c` on 2026-09-07: `place_call` still sends `<Say><Pause length="120">` on the originated leg (`python/scenario/voice/adapters/twilio.py:470-484`) and attaches media by rewriting the callee's webhook. No open PR or branch touches it. The 762 issue body names three guardrails the A-leg plan must cover: authenticate the media-stream websocket, restore a max call duration once `<Pause>` is gone, and allowlist outbound destinations. Those belong in the V2 phone story, not in a separate safety story.

### 4.3 Design decisions

| Question | Decision | Why |
|---|---|---|
| One agent type per transport, or one Voice agent? | **One Voice agent type** with a Reached via select inside the form. V1 has one option, ElevenLabs agent. Phone number joins in V2. | Everything downstream is identical. Separate types fork the picker, cards, icons and docs for a connection detail. |
| Where does the API key go? | **Settings, Model providers, ElevenLabs.** The agent form shows a read-only line naming the provider row and links to Settings if none is configured. | Provider is a credential concern and already has a home. Phone in V2 needs no provider at all. |
| Does the agent form have a model picker? | **No.** An ElevenLabs agent has no model to pick. The provider is implied by the transport. | A picker would offer a choice that does not exist. |
| Where does the model picker go? | **On the scenario, for the simulated caller's voice**, filtered to realtime and audio modes. The registry already tags those (`llmModels.json` mode `audio`; picker accepts only chat and embedding today, `ModelSelector.tsx:46`). | The caller is ours. Its voice is a model choice. The agent is theirs. |
| Separate voice scenario type? | **No.** A collapsed Caller voice section on the existing editor: voice with a project default, Interrupts off by default, Effects none by default. | Three knobs with defaults. The same scenario must run against the text agent and the voice agent for comparison. |
| Sweeping voices or accents? | **Existing scenario parameters.** Voice and interrupt probability as parameters. | A batch sweeps without copying the scenario. |
| Voice-specific criteria? | **Free text in V1.** | The judge takes strings. Structured latency and talk-over thresholds come with run-level timeline data (X2). |

### 4.4 User flow

The flow starts where the user's intent starts, in the scenario, and detours out to create the agent and its credential before coming back to finish the wiring.

1. **Create scenario.** Scenarios, New scenario. Situation, persona and criteria as today. Under Agent, the target picker lists existing agents and a New agent entry.
2. **New agent, Voice agent.** The type selector opens from the scenario. It gains one card, Voice agent, next to HTTP agent and Code agent.
3. **Voice agent drawer, first pass.** Name. Reached via, a select with one V1 option, ElevenLabs agent. Agent id, from the ElevenLabs dashboard. The Credentials line reads "No ElevenLabs key in this project" with an Add key link. The draft is kept while the user leaves.
4. **Provider.** Settings, Model providers, ElevenLabs. Paste the API key, save. Exists today. One line of copy is added: voice agents sign their sessions with this key. A back link returns to the drawer.
5. **Back to voice agent, finish setting up.** The Credentials line now names the provider row. Save. The agent appears in the scenario's picker, already selected.
6. **Test.** Talk to it on the drawer. A side panel opens: Connecting, then a live timer, a live two-speaker transcript, and Hang up. The browser opens the ElevenLabs session with the signed URL the gateway minted. Audio flows browser to ElevenLabs directly, the same shape the SDK adapter uses. On hang up the panel shows the transcript, a Play button, and a link to the run it created. Connection test and demo moment in one.
7. **Back to scenario, finish wiring.** The voice agent is the selected target. One new collapsed group, Caller voice: model picker filtered to voice models with a project default, Interrupts slider off, Effects none. Nothing here mentions ElevenLabs. Save the scenario.
8. **Run.** Run starts the simulated caller in the server-side pool, and per-turn audio streams into the run console as SDK voice runs do today. Call it myself opens the same mic panel as step 6, tagged with the scenario, so the judge scores your call against its criteria when you hang up.
9. **View results.** The existing run view. Per-turn audio, transcript, verdict, criteria chips. A Caller column reads Simulated or You. A Play recording button when the ElevenLabs recording fetch succeeded.

Two screens are new, the drawer and the panel. The others gain a card, a callout, a back link, a collapsed group or a button.

### 4.5 Stories

Each story states who, what they do, what they see, what it needs and where it sits.

**E1. Register an ElevenLabs agent**
- **Who:** an AI engineer who owns a voice agent on ElevenLabs.
- **Does:** New Agent, Voice agent, pastes the agent id, saves.
- **Sees:** the agent in the list with a mic icon. If no ElevenLabs key is configured, a callout with a link to Settings, and Save still works.
- **Needs:** `voice` value for `Agent.type`; config `{ transport: "elevenlabs_convai", agentId }`; Voice agent card in the type selector; `AgentVoiceEditorDrawer` mirroring `AgentHttpEditorDrawer.tsx`; a `voice` value in `SimulationTarget.type` (`simulation-target.ts:11-14`); icon and label in `AgentCard.tsx:38-46`.
- **Sits:** V1, first.

**E2. Talk to it from the agent drawer**
- **Who:** the same engineer, or anyone doing a demo.
- **Does:** presses Talk to it, allows the mic, talks, hangs up.
- **Sees:** live timer and two-speaker transcript while talking. After hang up, the transcript, Play, and a link to the run. Max duration enforced client-side and shown as a countdown in the last minute.
- **Needs:** a tRPC route that calls the gateway signed-URL mint with the project's ElevenLabs credential and returns signed URL plus conversation id; the ElevenLabs browser SDK loaded in the panel; a post-call job that fetches the conversation transcript and recording by id with the same key and writes a run with per-turn parts; a consent notice on the panel; `X-LangWatch-Guardrails-Not-Applied` behaviour documented, since the conversation never passes through the gateway.
- **Sits:** V1, the wow slice.

**E3. Have a simulated caller test it**
- **Who:** a QA lead.
- **Does:** picks a scenario, picks the voice agent, presses Run.
- **Sees:** the run console fill turn by turn with caller and agent audio, then verdict and criteria. In a batch, the results table like any text run.
- **Needs:** the execution pool (`execution-pool.ts`) resolving a `voice` target into the SDK's `ElevenLabsAgentAdapter` with the project credential, and the user simulator with the scenario's Caller voice settings; a per-project concurrency cap for voice runs; a max call duration; the existing per-turn audio path (`MediaPart.tsx`, `useSequentialAudioPlayback.ts`).
- **Sits:** V1, the core.

**E4. Choose the caller's voice**
- **Who:** the QA lead.
- **Does:** expands Caller voice on the scenario, picks a voice, sets Interrupts to 20 percent.
- **Sees:** the picker lists only realtime and audio models the project has credentials for, with the project default preselected.
- **Needs:** `ModelSelector.tsx` accepting `audio` and `realtime` modes; three fields on the scenario config with defaults; the pool passing them to the user simulator (`voice`, `interrupt_probability`, `audio_effects`).
- **Sits:** V1.

**E5. Call it myself from a scenario**
- **Who:** the QA lead, checking a criterion by hand.
- **Does:** picks the scenario and the voice agent, presses Call it myself, talks, hangs up.
- **Sees:** the same panel as E2, then a run scored against the scenario's criteria with Caller: You.
- **Needs:** E2 plus the run tagged with the scenario id and routed through the judge.
- **Sits:** V1.

**E6. Sweep voices in a batch**
- **Who:** the QA lead.
- **Does:** sets voice and interrupt probability as scenario parameters, runs the batch.
- **Sees:** one row per parameter set in the results table.
- **Needs:** the Caller voice fields accepting parameter references, which the parameter system already supports for text fields.
- **Sits:** V1 if free, else early V2.

**P1. Phone number as a target (V2)**
- **Who:** a QA lead whose agent is reachable only by phone, or built on a stack that is not ElevenLabs.
- **Does:** New Agent, Voice agent, Reached via: Phone number, types the number. Then E3 and E5 work unchanged.
- **Needs:** scenario 762 with its three guardrails (websocket auth, max duration after `<Pause>` goes, outbound allowlist); a LangWatch-owned Twilio number; a public media-stream ingress and long-lived session in the pool; a Twilio browser softphone for Call it myself with two-channel recording and gateway transcription (`POST /v1/audio/transcriptions`).
- **Sits:** V2. Plan for 762 this week so it is ready when V1 ships.

**X1. Run-level recording, timeline and latency (cross-cutting)**
- The SDK computes them (`python/scenario/voice/recording.py`) and never sends them (`scenario_executor.py:2088-2115`). Needed for whole-call playback (langwatch 4627), latency in `MetricsSummary.tsx`, and honest docs. Independent of transport. Start it in parallel with E3.

**X2. Compare text and voice agents on one scenario (cross-cutting)**
- Run the same scenario against the HTTP agent and the Voice agent and see both in one results table. Falls out of keeping one scenario type. Needs only a modality column.

### 4.6 Build order

1. **E1 and E3.** Agent type, drawer without Talk to it, pool wiring to the existing adapter. This is a working simulated caller in the app and proves the pool can hold a voice session.
2. **E2.** Signed-URL route, mic panel, post-call transcript and recording fetch. First demo.
3. **E4 and E5.** Caller voice group, picker modes, Call it myself on the run dialog. V1 complete.
4. **X1 in parallel from step 1.** It unblocks the whole-call player and honest latency.
5. **E6, X2.** Cheap once the above land.
6. **P1.** Write the 762 plan now, build after V1.

### 4.7 Open questions for the product owner

- Transcript retention must be on for the agent in ElevenLabs or the post-call fetch returns nothing. Do we detect and explain that, or document it?
- The browser session goes browser to ElevenLabs, so no gateway guardrail runs on it. Is a visible "guardrails not applied" note on the panel enough for V1?
- Which ElevenLabs plan tiers return the conversation audio by API? Confirm before promising Play recording.
- Consent notice per country on the Talk to it panel. Confirm the copy.
- For V2 phone: which number does the agent see as caller ID, and does the Twilio plan support two-channel recording?

### 4.8 Secondary stories, kept for the backlog

- Developer: one-line SDK helper to trace a live realtime call with audio stored out of band (langwatch 3968, 3969, scenario 674, 599).
- Platform admin: cut a gateway realtime session off when budget runs out (ADR-097 relay, four gates unmet).
- AI engineer: audio evaluators for transcription accuracy and silence gaps (langevals, absent).
- TS developer: LiveKit, Vapi and WebRTC adapters and TS docs tabs (scenario 563, 566).
- Lead: voice cost broken out per project (spend rater has the data).
- Any user: upload a recording and have it judged (langwatch 6283). Later.
- Any user: talk to Langy. No groundwork, later.

## 5. Next actions

- Merge or land https://github.com/langwatch/langwatch/pull/7830 for the credential leak.
- Unblock https://github.com/langwatch/scenario/issues/882 so JS CI is green.
- Reviewer queue, in order: 7830, 872 (undraft), 907, 950, 973, 863, 851 (rebase). Section 2.5.
- Human call on scenario 453 (Notion board) and langwatch 4157 (record the decision on the issue).
- Add a `voice` label in `langwatch/langwatch` and `langwatch/scenario` so this survey does not need 23 search terms next time.
- Spec E1 and E3 (Voice agent type, pool wiring to the ElevenLabs adapter) and start them. Then E2, the mic panel.
- Answer the questions in 4.7, especially ElevenLabs transcript retention and audio-by-API tiers, before promising Play recording.
- Write the plan for scenario 762 (Twilio A-leg to external numbers) this week, with its three guardrails. It is the long pole of V2, not V1.
- Spec run-level audio, timeline and latency to the platform. Worth doing even if the phone runner slips, and it fixes the docs over-promise.
- Fix the docs claim in `docs/agent-testing/voice-agents.mdx` that the app shows per-turn TTFB and p50/p95. It does not.
