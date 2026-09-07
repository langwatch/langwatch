# Voice: open-issue triage, feature completeness, and draft user stories

Date: 2026-09-07
Sources: `langwatch/langwatch` @ `8b51631777`, `langwatch/scenario` @ `ae0c921c` (both latest `main`), GitHub open issues across the `langwatch` org.
Status: research document, second pass. On 2026-09-07, 17 scenario issues verified as delivered were closed with a comment naming the delivering PR. Nothing was created or labeled. Any issue filing should go through `/create-issue`.

---

## 1. Headline

- **90 open voice/audio issues** across the org after this pass, down from 107. Scenario SDK 63, platform 19, langwatch-saas 6, two elsewhere. None carry a `voice` or `audio` label, in any repo.
- **17 closed as verified delivered, 31 "looked done" ones are not.** Of 48 issues that referenced a merged PR, only 17 survived a code check. The cross-reference signal is mostly dependency bumps. Details in 2.3.
- **The product story is LangWatch phoning the agent under test with a simulated caller, from the app.** A QA lead types the number, describes the caller, writes the criteria, presses Call, and gets the call back as a run with recording, transcript and verdict. It reuses the server-side scenario runner and per-turn audio console that already exist, and waits on one SDK fix, the A-leg media stream in scenario 762, which has no plan yet and is the long pole. A second button, Call it myself through the browser mic, is the wow slice, is platform-only, and ships alongside. Section 4.
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

## 4. User stories: call the agent under test from the platform

### 4.1 The story in one paragraph

A QA lead has a voice agent live on a phone number. They open LangWatch, type the number, describe the caller in a few sentences, write what a good call looks like, and press Call. LangWatch phones the agent, the simulated caller talks to it, and the finished call is in the app as a run: recording, transcript, verdict. No SDK, no local code, no Twilio account, no tunnel. That is the product, because it is the only way to test the endpoint without a person on the line, and it is what runs in batches after every deploy.

The same page has a second button: Call it myself. The tester talks to the agent through the browser mic and gets the same run back. It is the demo moment, it is cheap, and it shares the number field, target type, run record, transcript and judge with the simulated path. Both are v1. The simulated caller is the core; the live call is the wow slice.

### 4.2 Three paths, kept apart

The word "voice test" hides three different pipelines. Two are v1, and they share the number field, the run record, the transcript, the judge and the review screen.

| Path | Who talks to the agent | What the platform needs | Blocked on |
|---|---|---|---|
| **Simulated** (v1, the core) | A synthetic caller: persona text spoken by a realtime model or TTS plus STT | A `phone` target type, the scenario SDK Twilio adapter run in the existing server-side pool, a public websocket ingress for Twilio media streams, a call session that lives as long as the call | https://github.com/langwatch/scenario/issues/762 (A-leg media stream on the originated call). Not blocked by Twilio. Blocked by SDK work that has no plan yet. |
| **Live** (v1, the wow slice) | The tester, through the browser mic | A LangWatch-owned Twilio number, a browser softphone token, a TwiML bridge that dials the target number with recording on, a recording webhook, STT on the recording, a run record | Nothing outside the platform. Twilio browser calling and call recording are standard Twilio features. |
| **Upload** (later) | Nobody, the call already happened | Attach a recording, transcribe, judge | https://github.com/langwatch/langwatch/issues/6283 (file attach in authoring) |

Why Live can land first even though it is not the core: bridging a browser call to a phone number is a Twilio `<Dial>` with `record` set. Audio never passes through LangWatch during the call. Twilio posts the recording URL when the call ends. The gateway already exposes `POST /v1/audio/transcriptions`, and the run UI already renders audio parts, transcript, verdict and criteria. The missing pieces are a Twilio number owned by LangWatch, a token endpoint, one TwiML handler, one webhook, and a page.

Re-verified on scenario main `ae0c921c` on 2026-09-07: `place_call` still sends `<Say><Pause length="120">` on the originated leg (`python/scenario/voice/adapters/twilio.py:470-484`) and attaches media by rewriting the callee's webhook. No open PR or branch touches it. The TypeScript adapter branch `issue372/ts-voice-twilio` copies the same shape. The only black-box voice adapters that reach a deployed agent today are ElevenLabs hosted ConvAI by agent id and Twilio against a number in your own account. The 762 issue body names three guardrails the A-leg plan must cover: authenticate the media-stream websocket, restore a max call duration once `<Pause>` is gone, and allowlist outbound destinations. Those belong in S1, not in a separate safety story.

Why Simulated is buildable now and not v2: the platform owns the Twilio account, so it can originate the call and put `<Connect><Stream>` on that originated leg pointing at its own websocket ingress. That is exactly the topology scenario 762 asks for. The SDK adapter today does the opposite, rewriting the callee's webhook, which only works for numbers you own. Once the adapter can stream on the originated leg, the rest is hosting: the scenario runner already exists in the platform and already streams per-turn audio into the run view. Cloud has public URLs, so no tunnel. Least config for the user is still a phone number plus the persona and criteria text they already write for text scenarios.

### 4.3 What exists today

| Building block | Status | Evidence |
|---|---|---|
| Twilio anything in the platform | Absent | No Twilio, SIP or telephony code in `platform/`, `services/`, `specs/`. |
| Credential store for a platform-owned Twilio account | Exists | Encrypted `ModelProvider.customKeys` already hosts ElevenLabs credentials. For v1 the account is LangWatch's, set by env, not per project. |
| Transcription | Exists | Gateway `POST /v1/audio/transcriptions` (`services/aigateway/adapters/providers/bifrost_audio.go`, `elevenlabs.go`). |
| Audio storage | Exists | Stored objects service, S3 and self-hosted backends. Self-hosted gaps in langwatch-saas 494, 796, 799 are not v1. |
| Run record and review UI | Exists | Simulation runs render audio parts (`MediaPart.tsx`), transcript, verdict (`RunCriteriaChip.tsx`, `CriteriaDetails.tsx`). Whole-call player with seek is not there (langwatch 4627, 5582). |
| Judge on a transcript | Exists | The scenario judge runs on messages. A recorded call becomes a two-role transcript after STT with diarization or two-channel recording. |
| Browser softphone | Absent | No WebRTC client code in the app. Twilio's browser SDK needs a short-lived access token minted server-side. |
| Target type `phone` | Absent | `platform/app/src/server/scenarios/simulation-target.ts:11-14` has `prompt`, `http`, `code`, `workflow`, `connected`. |
| Server-side scenario runner for the simulated caller | Exists | `platform/app/src/server/scenarios/execution/execution-pool.ts`, child processes, concurrency 3 per pod. Built for short batch runs, not held call sessions. |
| SDK Twilio adapter dialing an external number | Absent | `python/scenario/voice/adapters/twilio.py:66-90` rewrites the callee's webhook, so the callee must be in the same Twilio account. Fix is scenario 762. |
| Public websocket ingress for Twilio media | Absent | The SDK uses a cloudflared tunnel. The platform has none. Cloud has public URLs, so this is a route, not a tunnel. |
| Per-turn audio streamed into the run console | Exists | SDK voice runs already send `input_audio` parts per message and the console renders them. |

### 4.4 Stories

Persona: **Maya, QA lead**. She does not write code. Secondary: **Dev, the agent's engineer**.

**V1, the Live path, the wow slice. Config: a phone number.**

**L1. Call my agent from the app and talk to it.**
As Maya, I want to enter the agent's phone number, press Call, and talk to it through my browser mic, so that I can check a deployed agent by hand in under a minute.
Accept: one page: number field in E.164, Call button, mic permission prompt, live status (dialing, ringing, connected, ended), Hang up button. Timer visible. Call ends automatically at a max duration. Works on LangWatch cloud with no setup beyond a project.
Requires: LangWatch-owned Twilio number, token endpoint for the browser client, TwiML handler that dials the target with two-channel recording.

**L2. See the call as a run when I hang up.**
As Maya, I want the finished call to appear in the simulations list as a run with the recording and a transcript split by speaker, so that I can review and share it.
Accept: run appears within a minute of hang-up. Player for the whole recording. Transcript with two speakers labeled Tester and Agent. Duration, target number, who called. Playable in the same conversation view as SDK runs.
Requires: recording webhook, STT through the gateway with two-channel input, run record with a new `phone` target type.

**L3. Judge the call against criteria I wrote.**
As Maya, I want to write pass criteria before calling and get a verdict on the transcript after, so that manual calls produce the same evidence as automated scenarios.
Accept: optional criteria textarea on the call page. Verdict and per-criterion chips as in SDK runs. No criteria, no verdict.
Requires: run the existing judge on the STT transcript.

**L4. Tell me why the call did not connect.**
As Maya, I want a plain reason when nothing happened: no answer, busy, invalid number, mic blocked, Twilio error, so that I fix it instead of guessing.
Accept: distinct statuses on the run with the Twilio error code where present.
Requires: mapping Twilio call status callbacks to run status.

**V1, the Simulated path, the core. Config: the number, plus the persona and criteria text.**

**S1. Have a simulated caller phone my agent.**
As Maya, I want to describe the caller in a few sentences, pick a voice, and press Call, so that the same scenario can be run against the deployed agent without me on the line.
Accept: on the same call page, a switch between Me and Simulated caller. Persona and criteria use the existing scenario authoring fields. Live status and per-turn transcript stream into the run console as the call happens, as SDK voice runs do today. Max duration and Hang up as in L1.
Requires: `phone` entry in `SimulationTarget`, the scenario SDK Twilio adapter running in the existing execution pool, a public websocket ingress for Twilio media streams, a call session that stays up for the whole call, and the A-leg stream fix in scenario 762. Voice style from scenario 533 and 862.

**S2. Save the number as a target and run any scenario against it.**
As Maya, I want the number saved as a project target so that every voice scenario and scenario set in the project can be pointed at it.
Requires: S1. Reuses target selection as for http and prompt targets.

**V2.**

**S3. Run a batch of callers on a schedule and trend it.**
As Maya, I want a set of caller personas run after each agent deploy with pass rate and latency per persona.
Requires: S2 plus run-level timeline and latency carried to the platform (today computed in the SDK and never sent, `scenario_executor.py:2088-2115`).

**S4. Get through an IVR menu first.**
As Maya, I want the simulated caller to press keys to reach the agent behind a phone tree.
Requires: S1, plus the SDK DTMF work in scenario 464.

**Cross-cutting, either path.**

**X1. Link the call to the agent's trace.**
As Dev, I want the run to link to the trace my agent emitted for that call, matched by Twilio call SID or by caller number and time window.
Requires: SDK audio and realtime helpers (langwatch 3968, 3969, scenario 674).

**X2. Play the whole call with turn markers and latency.**
As Maya, I want one player with seek and per-turn response latency, so that I can tell wording problems from slowness.
Requires: langwatch 4627 (parked), 5582 (seek), and for the Live path a per-turn split derived from the two-channel recording.

### 4.5 Build order

Two tracks run in parallel from day one. Track A is the core and has the long pole, scenario 762, so it starts first. Track B is the wow slice, platform-only, and will finish first because it is small. Nothing in Track B is throwaway: the target type, run record, STT step and judge step are the same code the core uses.

1. **Track A, scenario 762.** Written plan this week, then the A-leg `<Connect><Stream>` change in the SDK Twilio adapter, tested against our own numbers first and an external number second.
2. **Track A, S1.** `phone` target type, media-stream ingress and long-lived call session in the platform, adapter run in the execution pool, call page with persona, criteria, Call, live turn console. Per-project concurrency cap and max duration. This is the product.
3. **Track B, L1, L2.** Softphone page, token endpoint, TwiML bridge with two-channel recording, recording webhook, STT via the gateway, run record and playback. Reuses the target type and run record from S1, or lands them first if it gets there sooner.
4. **Track B, L3, L4.** Judge on transcript, connect-failure statuses. Call it myself is complete.
5. **S2.** Saved target so scenario sets can point at the number. Small once S1 exists. v1 complete.
6. **X2, S3, S4, X1.** Whole-call player, batches on a schedule, IVR, trace link.

Dropped from the earlier draft: the standalone safety policy story (allowlists, cost caps, hours) is out of scope. A max duration and a per-project concurrency cap on simulated calls are folded into L1 and S1. The self-hosted bring-your-own-Twilio story is folded away: v1 runs on a LangWatch-owned number on cloud only.

### 4.6 Open questions for the product owner

- Which number does the agent see as caller ID? A LangWatch number means agents that whitelist callers will reject the test.
- Two-channel recording gives clean speaker separation. Confirm the Twilio plan supports it.
- Recording consent varies by country. v1 shows a consent notice on the call page. Confirm that is enough for the target markets.

### 4.7 Secondary stories, kept for the backlog

- Developer: one-line SDK helper to trace a live realtime call with audio stored out of band (langwatch 3968, 3969, scenario 674, 599).
- Platform admin: cut a gateway realtime session off when budget runs out (ADR-097 relay, four gates unmet).
- AI engineer: audio evaluators for transcription accuracy and silence gaps (langevals, absent).
- TS developer: LiveKit, Vapi and WebRTC adapters and TS docs tabs (scenario 563, 566).
- Lead: voice cost broken out per project (spend rater has the data).
- Any user: talk to Langy. No groundwork, later.

## 5. Next actions

- Merge or land https://github.com/langwatch/langwatch/pull/7830 for the credential leak.
- Unblock https://github.com/langwatch/scenario/issues/882 so JS CI is green.
- Reviewer queue, in order: 7830, 872 (undraft), 907, 950, 973, 863, 851 (rebase). Section 2.5.
- Human call on scenario 453 (Notion board) and langwatch 4157 (record the decision on the issue).
- Add a `voice` label in `langwatch/langwatch` and `langwatch/scenario` so this survey does not need 23 search terms next time.
- Answer the three questions in 4.6, then spec L1 and L2. Provision a LangWatch-owned Twilio number for cloud.
- Write the plan for scenario 762 (Twilio A-leg to external numbers) this week. It is the long pole of v1.
- Spec run-level audio, timeline and latency to the platform. Worth doing even if the phone runner slips, and it fixes the docs over-promise.
- Fix the docs claim in `docs/agent-testing/voice-agents.mdx` that the app shows per-turn TTFB and p50/p95. It does not.
