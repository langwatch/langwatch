# ADR-097: Realtime voice in the AI Gateway: broker sessions, relay only what pays for the hop

**Date:** 2026-08-13

**Status:** Accepted (2026-08-14)

## Context

Realtime voice traffic does not pass through the LangWatch AI Gateway. Customers running voice agents connect straight to OpenAI, ElevenLabs or Google, so that spend carries no virtual key, no budget, and no trace. Our own voice test harness does the same: the simulator, judge, speech-to-text and text-to-speech legs route through `gateway.langwatch.ai` because they are OpenAI-shaped, while the ElevenLabs conversation itself bills a separate account.

The gateway already serves request-and-response audio. `POST /v1/audio/speech` and `POST /v1/audio/transcriptions` shipped for OpenAI and ElevenLabs in `langwatch/langwatch#6168`, with per-character and per-second pricing in the model catalog. The position on sockets lives in documentation prose, at `docs/ai-gateway/api/audio.mdx` line 91, under a heading titled "Not yet supported":

> **Realtime voice websockets** (OpenAI Realtime, ElevenLabs ConvAI): connect directly to the provider for realtime sessions; the gateway serves the request/response audio endpoints.

No ADR decided that. It describes a state we had not built, phrased as a workaround.

Meanwhile the gateway holds no websocket at all. A search across `services/aigateway/` for `websocket`, `Hijacker` or upgrade handling returns nothing, and the three `http.ResponseWriter` wrappers that every request passes through, in `adapters/gatewaymetrics/http.go`, `adapters/gatewaytracer/tracer.go` and `pkg/httpmiddleware/telemetry.go`, implement `Unwrap()` but not `http.Hijacker`. A gorilla-style upgrade fails on the type assertion before any voice code runs.

Five competing gateways already proxy realtime voice websockets: Cloudflare AI Gateway, LiteLLM, Portkey, Helicone and Kong. Braintrust shipped it and then deprecated the proxy docs. Our own Kong benchmark at `bench-gateway-kong` records the route-type comparison as "THEY WIN, clearly", counting 15 Kong Enterprise route types including realtime against our three. That benchmark predates `#6168` and its LangWatch column is stale, but the realtime gap it names is real.

### Three protocol families, and only two of them are the same problem

Vendor documentation splits realtime voice cleanly by where the agent runs.

1. **Model over a socket.** OpenAI Realtime, Gemini Live, Azure Voice Live in model mode. The client declares the entire session over the wire: instructions, voice, tools, turn detection, audio formats. Nothing is pre-registered with the vendor. Auth is a bearer header for servers, or an ephemeral credential minted by a REST call for browsers. Usage arrives over the socket itself, as `response.done.usage` on OpenAI and `usageMetadata` on Gemini.

2. **Hosted agent platform.** ElevenLabs Conversational AI, Azure Foundry agent mode. The prompt, tools, knowledge base, voice, guardrails, workflows and turn model live on the vendor and are addressed by an `agent_id`. The socket carries a conversation with the vendor's orchestrator. ElevenLabs publishes no header auth path at all: a private agent needs a signed URL from `GET /v1/convai/conversation/get-signed-url`, bound to one agent and valid 15 minutes. Usage never arrives over the socket. Cost arrives afterwards, on a post-call webhook carrying `cost_fiat` in USD.

3. **Vendor administration.** Creating an agent, listing voices, uploading a knowledge base, managing pronunciation dictionaries. Every vendor shapes these differently.

Family 2 cannot be relayed by swapping a credential at handshake time, because the credential is a signature the vendor mints rather than a token we hold. Any support for it requires the gateway to make that REST call itself. So the line between what the gateway carries and what it does not is session establishment against vendor administration, and it does not follow the boundary between REST and websockets.

### What the money path does today

Three findings constrain any answer.

1. **The pricing catalog already prices non-token units, and the billing path ignores them.** `inputCostPerCharacter` and `inputCostPerSecond` are populated for nine audio models and priced correctly by `estimateCost` in `platform/app/src/server/tracer/collector/cost.ts`. `openai/gpt-realtime-whisper` sits in the catalog at $0.00028333 per second. But `rateSpendNanoUsd` in `spend-rating.service.ts` calls `estimateCost` without passing `inputCharacters` or `audioSeconds`, and `usageFromDomain` in `services/aigateway/adapters/spendemitter/record.go:109` maps `domain.Usage` onto a five-field token struct that has nowhere to put either quantity.

2. **Character-priced and second-priced calls bill zero, measured against production.** Three `openai/tts-1` calls totalling 12,000 characters should have cost $0.18. The organization budget moved $0.0002 over the next four minutes, which is the background rate from unrelated traffic. A control `gpt-4o` request predicted at $0.02227 moved the same budget by $0.02230 within two minutes, so the spend pipeline was working and did not see the audio. The trace for one text-to-speech call carries `gen_ai.usage.input_chars` of 43 and a cost of $0.000645, which is 43 characters at the catalog rate, so the observability lane prices what the billing lane rates at zero. A transcription call returned `"usage": {"type":"duration","seconds":3}` in its own response body, so the second-priced quantity was measured, handed to the client, and never billed. Nothing warns, because a rate rule does match `openai/tts-1`, so the "no rate rule matched" log that guards against silent zero-rating never fires. This contradicts a shipped `@unit` scenario at `specs/ai-gateway/audio-endpoints.feature:117` asserting "an allowed call's spend is recorded against the same budget". Filed as `langwatch/langwatch#6934`.

3. **Nothing meters a request while it runs.** The spend spine issues exactly one admission and one terminal outcome per request, guarded by `sync.Once` in `app/pipeline/spend.go`, and `gateway_budget_ledger_events` is keyed `(TenantId, BudgetId, GatewayRequestId)`, which means one debit per budget per request. ClickHouse 25.8 rejects `ALTER MODIFY ORDER BY` on a pre-existing column, so that key cannot gain a tick dimension later. Budget checks run once before dispatch against a snapshot baked into a cached bundle, and `docs/ai-gateway/budgets.mdx` defends that with a stated principle of no control-plane round trip on the hot path.

Rate limits count arrivals rather than occupancy. A key configured at 60 requests per minute can hold 60 concurrent ten-minute calls per replica, which is 600 call-minutes of provider spend, without tripping anything. The `tpm` field that might have helped is carried across the wire and then discarded by the decoder in `adapters/controlplane/config_wire.go:192-197`.

### What the operational path does today

Production runs three gateway replicas behind an L4 network load balancer, scaling to 20. `terminationGracePeriodSeconds` is 620, and a Terraform comment claims the Go code bounds drain at 600 seconds, but it does not. `pkg/lifecycle/group.go` builds a shutdown context with a 60 second timeout, and production sets no override. Separately, Go's `http.Server.Shutdown` does not wait for hijacked connections, so a websocket would not receive even those 60 seconds. There is no preStop hook, no PodDisruptionBudget in production, and no session affinity.

ADR-053, "Tenant-aware egress and per-workload sandbox isolation", status Proposed, states the constraint that applies most directly:

> The public AI gateway remains responsible for authentication, virtual-key authorization, request shaping, and streaming responses. It does not directly dial tenant-selected destinations. It calls a private, mutually authenticated egress service with the signed envelope.

Its target topology names public providers explicitly: only the egress service may make the final destination connection. Track C has shipped nothing, and the gateway already dials ElevenLabs directly for the audio routes, so a websocket would extend an existing divergence rather than open a new one. The envelope ADR-053 specifies is bounded by a timeout and a maximum response byte count, which does not describe an open bidirectional stream.

## Decision

We will support realtime voice in the LangWatch AI Gateway, and we will choose the mechanism by where the agent runs rather than by vendor.

1. **A realtime session broker is the default mechanism for both socket families.** The gateway exposes a session endpoint. A client presents a virtual key and names a target. The gateway checks the budget, resolves the customer's stored provider credential, mints the vendor's short-lived session credential, and returns it together with a LangWatch session id. Media flows from the client to the vendor. The gateway books the session as one spend record, admitted at mint and confirmed at close from the vendor's reported usage.

2. **We will not relay the socket of a hosted agent platform.** ElevenLabs Conversational AI is brokered and never proxied. Its agent cannot be made portable without reimplementing the vendor's orchestrator, its post-call webhook reports authoritative cost that a relay would have to estimate, and a relay hop is charged against turn latency twice per turn for no gain the broker does not already deliver.

3. **We will relay the model-over-socket family only after the gated conditions below are met.** OpenAI Realtime, Gemini Live and Azure Voice Live in model mode report usage over the socket and swap a bearer credential cleanly, so a relay buys frame-level tracing, mid-session enforcement, and usage we can meter without vendor cooperation.

4. **Vendor administration APIs stay outside the gateway.** Creating agents, listing voices and uploading knowledge bases carry no inference, need no portability, and give us nothing by sitting in the path.

5. **WebRTC media is out of scope.** OpenAI, ElevenLabs and Azure all recommend WebRTC for browser clients. Terminating it means ICE, DTLS and SRTP, which is a media-server problem rather than a proxy problem. The broker covers WebRTC clients at session establishment, because the SDP exchange and the ephemeral credential both pass through a REST call we already intend to own.

### Gates on the relay

We will not build the media relay until all four hold.

1. ADR-053 Track C is resolved for long-lived connections, either by an egress service that carries a bidirectional stream or by an explicit, dated amendment recording that gateway pods may dial named provider hosts directly.
2. Connection draining survives a rolling deploy without severing live calls, which needs a preStop hook, a real graceful budget, a PodDisruptionBudget, and a reconnect protocol the client can act on.
3. Per-key concurrency limits exist, because request-arrival limits do not bound a socket.
4. A named customer requirement asks for something the broker cannot deliver, meaning mid-session budget termination or frame-level tracing.

### Prerequisites, in order

1. **Fix the zero-billed audio path**, `langwatch/langwatch#6934`. Character-priced and second-priced calls must debit. Widening a pricing row that the billing rater does not read would change nothing.
2. **Make the spend quantity vocabulary unit-generic.** `UsagePayload` in Go, `spendUsageSchema` in Zod, the fold state, the debit intent, and both ClickHouse tables all carry five fixed token classes. A voice minute needs somewhere to state what it was charged for, or a dollar figure cannot be reconciled against a duration. Prices themselves need no change.
3. **Add per-key concurrent session limits.**

## Rationale and trade-offs

**Brokering fits the spend spine as it stands.** A brokered session is one billable unit with one identity, so `gateway_request_id` keeps its meaning, the ledger key keeps its one-debit-per-request semantics, and the absolute-writes rule holds. Relaying with per-tick metering needs a session id plus a tick sequence, a non-terminal state in a lattice whose every terminal state is final today, a repeatable partial-confirmation event, and a ledger sort key that ClickHouse will not let us alter. Relaying means opening that lifecycle.

**For ElevenLabs, brokering produces better billing data than relaying.** A relay would meter a conversation from its own wall clock and then disagree with the vendor invoice over rounding, minimums and silence discounts. The post-call webhook carries `cost_fiat` and a platform charge breakdown, which is the number the customer will be billed. Reading it is more accurate and costs less.

**Latency is charged on every turn.** Kong's voice cookbook puts natural turn latency under roughly 800 milliseconds end to end. A relay adds a round trip in each direction on every turn, and the region where our gateway runs may not match either the customer or the vendor. Voice quality degrades in a way a chat completion's added 40 milliseconds does not.

**Observability through the gateway is worth less for voice than it looks.** LiteLLM logs only `session.created`, `response.create` and `response.done` by default, and documents the reason as preventing dropped requests. Kong states that per-hop observability disappears by design with realtime APIs, because the vendor collapses speech-to-text, inference and text-to-speech into one opaque leg. Our own trace path already renders voice: the ingest extractor handles the OpenAI Realtime `input_audio` part shape, the trace drawer plays it back, and Scenario ships voice adapters. Production voice traces can arrive from the SDK, which is where our voice evaluation story already lives.

**What the gateway uniquely provides for voice is credential custody and budget admission.** Both are delivered by the broker. We take the governance value now at low cost, and we buy the enforcement and tracing value later, once we can hold a socket without dropping calls on every deploy.

**The trigger for this work is satisfied by the cheap option.** Routing our own continuous-integration ElevenLabs spend onto a virtual key needs the broker and nothing else. Building a relay to solve it would be the wrong size of answer.

## Alternatives considered

**Relay everything now, matching Portkey and Helicone.** Rejected for sequencing rather than for principle. It requires hijack support through three middleware wrappers, an amendment to ADR-053, a drain story, occupancy limits, a new aggregate lifecycle in the spend pipeline, and a decision about per-chunk guardrails, which currently make a synchronous control-plane call with a 50 millisecond budget for every chunk and would issue roughly 100 calls per second per call at voice frame rates. Each of those is tractable, but together they are not a first step.

**A unified cross-vendor realtime protocol where a customer swaps providers by changing one string.** Rejected as over-reach. It works for the model-over-socket family, and LiteLLM has already shipped exactly that scope. It cannot include ElevenLabs Conversational AI, because the thing at the other end is a vendor's agent runtime rather than a model. Audio sample rates, turn-detection tunables, interruption semantics and tool-calling shapes also diverge, and OpenAI's `conversation.item.truncate` requires an `audio_end_ms` describing how much audio the client actually played, which only the client knows and a proxy cannot synthesize.

**Meter from the SDK and leave the gateway out.** Rejected because it cannot enforce. A budget a customer can evade by not calling our SDK is not a budget, which is the same reason `ATTRIBUTED_USER` templates fail closed with `end_user_required`. The SDK remains the right place for voice traces, and this decision keeps it there.

**Proxy the vendor management REST APIs.** Rejected. They carry no inference and no spend, they differ completely between vendors, and proxying them would add a hop with nothing on the other side of the trade.

**Do nothing and keep the documented workaround.** Rejected. Voice spend stays outside every budget, a customer running voice agents gets no spend governance from us, and the competitive gap our own Kong benchmark records stays open.

## Consequences

**Positive.** Voice spend enters the budget system for the first time. Customer provider keys for voice vendors come under the same custody as every other credential. Our continuous-integration voice spend lands on a virtual key. The prerequisites fix a metering defect on shipped audio endpoints that exists today regardless of this decision. The gateway takes on no long-lived state, so no new failure mode reaches chat completions.

**Negative.** A brokered session cannot be terminated when its budget is crossed, so a voice budget admits at session start and reconciles afterwards. Overshoot for voice is bounded by session length rather than by one request, which is a materially weaker guarantee than the existing minute-scale bound and must be documented in those words. The gateway does not see conversation frames, so turn-level latency, interruptions and transcripts reach LangWatch only when the customer's SDK reports them. Usage for OpenAI Realtime under a broker depends on the vendor's usage API or the SDK, because the socket that carries `response.done.usage` does not pass through us.

**Neutral.** The gateway takes on one narrow vendor REST call per family, for session establishment. `agent_id` becomes part of the addressing for ElevenLabs, which is the same choice Cloudflare made. A brokered session needs a new spend record shape whose quantity is a duration, which is the unit-generic work listed as a prerequisite.

**Risks worth naming.** ADR-053 Track C forbids the direct dial that even the broker's mint call performs, though that call is short, bounded and shaped exactly like the envelope Track C describes, unlike a socket. Vendor usage reporting is the single point of truth for brokered billing, so a vendor webhook outage becomes a billing gap rather than a service outage, and it must fail visibly under the existing rule that losses are never silent. ElevenLabs publishes regional residency endpoints, so brokering must preserve the region the customer selected.

## References

- Related Nexus pages (internal wiki, no repo link): `gateway-spend-command-pipeline-adr`, `skai-gateway-replacement-adr`, `bench-gateway-kong`, `feature-ai-gateway`, `feature-gateway-virtual-keys`, `feature-voice-agent-testing`, `pain-voice-agent-testing-cost`
- Repo ADRs: `053-tenant-aware-egress-and-workload-isolation.md` (Proposed), `017-gateway-trace-payload-capture.md` (Accepted, and not the regime running in code), `016-scoped-model-providers.md`, `021-multi-scope-targeting-and-tenancy.md`, `018-governance-unified-observability-substrate.md`
- Scenario ADRs, in the `langwatch/scenario` repository: `docs/adr/002-voice-provider-state.md` (Proposed), `docs/adr/003-voice-internal-design.md` (Accepted)
- Shipped audio support: `langwatch/langwatch#6168`, `specs/ai-gateway/audio-endpoints.feature`, `docs/ai-gateway/api/audio.mdx`
- Vendor documentation: OpenAI Realtime websocket and costs guides, ElevenLabs Conversational AI websocket and authentication references, Google Gemini Live API and session management, Deepgram Voice Agent reference, Azure Voice Live how-to
- Competitor realtime support: Cloudflare AI Gateway realtime websockets, LiteLLM `/v1/realtime`, Portkey realtime API, Helicone realtime integration, Kong voice AI observability cookbook

### Doc changes this decision requires when it lands

- `docs/ai-gateway/api/audio.mdx`, the "Not yet supported" block, currently tells customers to connect directly to the provider.
- `bench-gateway-kong`, whose LangWatch route-type column predates `#6168`.

### Resolutions (2026-08-14)

1. Voice customers run server-side websockets for OpenAI Realtime today, so the broker reaches them with no WebRTC work. The WebRTC exclusion in the decision costs us nothing now.
2. Admission at session start is enough control for the enterprise governance buyer. Mid-session termination is not required, so the media relay stays behind its four gates.
3. The settlement grace stays at 30 minutes. A late vendor webhook supersedes a settled record by design, so a call that outlives the grace still settles at the cost the vendor reports.
