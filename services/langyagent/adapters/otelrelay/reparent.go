package otelrelay

import (
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

// Reserved resource-attribute keys the LangWatch OTLP ingest maps onto trace
// metadata (see specs/langy/langy-otel-tracing.feature): tag.tags becomes the
// trace's labels, langwatch.thread.id its thread grouping.
const (
	attrTags     = "tag.tags"
	attrThreadID = "langwatch.thread.id"
	attrOrigin   = "langwatch.origin"
	attrUserID   = "langwatch.user.id"
)

// OTel GenAI semantic-convention keys, stamped ALONGSIDE the reserved
// LangWatch pair above. The ingest maps both spellings onto the same trace
// metadata (metadata.ts: gen_ai.conversation.id -> thread_id, user.id ->
// user_id), but the semconv keys are what the product's span-attribute
// filters read (`Attributes['gen_ai.conversation.id']` in the trace
// explorer's thread filter) and what any third-party OTel consumer
// understands — so the relayed traces carry the standard names too.
const (
	attrGenAIConversationID = "gen_ai.conversation.id"
	attrEndUserID           = "user.id"
)

// attrCostNonBillable marks a span's usage as covered by a subscription
// (bundled) rather than paid API spend — the same span-level flag Claude Code
// bundled tracking uses, and the signal cost classification treats as
// authoritative. The relay stamps it on codex-turn model-call spans
// (StampCodexNonBillable) and SWEEPS any worker-supplied value: a worker on a
// paid API key must not be able to mark its own usage free.
const attrCostNonBillable = "langwatch.cost.non_billable"

// attrSkipTokenAccumulation marks a span whose token usage is a redundant
// copy of another span's, so the ingest's trace-summary fold counts the usage
// once while the per-span detail stays visible. Every worker LLM call is
// MEDIATED (OPENAI_BASE_URL pins the relay), so the gateway's own gen_ai span
// (stitched into the same trace via the injected traceparent) is the
// authoritative meter for tokens and cost; the worker SDK's model-call spans
// report the SAME call and would double the trace totals without this stamp.
const attrSkipTokenAccumulation = "langwatch.reserved.skip_token_accumulation"

// genAIModelSignalKeys are the span attributes that mark a relayed span as a
// model call for cost purposes. Only these spans get the non-billable and
// usage-dedup stamps; tool and plumbing spans carry no cost to classify.
// The ai.model.* pair is what opencode's Vercel AI SDK spans actually carry
// on the wire (verified against live exports); the gen_ai.* names only appear
// after ingest canonicalisation, so matching them alone misses every real
// worker batch.
var genAIModelSignalKeys = []string{
	"gen_ai.provider.name",
	"gen_ai.request.model",
	"gen_ai.response.model",
	"ai.model",
	"ai.model.id",
	"ai.model.provider",
}

// StampCodexNonBillable marks every model-call span in the batch as bundled
// usage. Call it ONLY when the manager-held provider for the turn is codex
// (the ChatGPT-plan device-auth provider): a bare model name is
// indistinguishable from paid API usage, so the discriminator is the
// provider/auth mode the manager knows, never the model string or anything
// worker-supplied. gen_ai.provider.name is left as the worker reported it —
// the honest provider name has value; the bundled signal is this flag.
func StampCodexNonBillable(td ptrace.Traces) {
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				if !hasModelSignal(span.Attributes()) {
					continue
				}
				span.Attributes().PutStr(attrCostNonBillable, "true")
			}
		}
	}
}

func hasModelSignal(attrs pcommon.Map) bool {
	for _, key := range genAIModelSignalKeys {
		if _, ok := attrs.Get(key); ok {
			return true
		}
	}
	return false
}

// trustedModelKeys are the span attributes that NAME a model on a worker
// span, across both the semconv spelling and the Vercel AI SDK wire spelling
// the ingest canonicalises from. SubstituteTrustedModel rewrites whichever
// are present.
var trustedModelKeys = []string{
	"gen_ai.request.model",
	"gen_ai.response.model",
	"ai.model.id",
	"ai.response.model",
}

// SubstituteTrustedModel replaces the model name on every model-call span
// with the manager-held, platform-canonical id (provider-prefixed, exactly as
// the user configured it). Two reasons, the same posture the mirror lane
// already takes: the worker-supplied value is an arbitrary string that may
// carry content, and it is spelled however the worker's SDK happens to run:
// the codex lane runs the native openai provider on the BARE wire-name, so
// its spans would name the same model differently from the gateway's gen_ai
// span and the trace's model filter would list one model twice.
func SubstituteTrustedModel(td ptrace.Traces, trustedModel string) {
	if trustedModel == "" {
		return
	}
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				if !hasModelSignal(span.Attributes()) {
					continue
				}
				for _, key := range trustedModelKeys {
					if _, ok := span.Attributes().Get(key); ok {
						span.Attributes().PutStr(key, trustedModel)
					}
				}
			}
		}
	}
}

// StampMediatedUsageDedup marks every model-call span in the batch as a
// redundant usage copy: the gateway's gen_ai span is the meter for a mediated
// LLM call, and without this stamp the trace totals count every call twice
// (once from the worker SDK's span, once from the gateway's). Called for
// every relayed batch: mediation is unconditional, so the dedup is too. The
// stamp can only reduce what the worker's own spans contribute, so a worker
// pre-setting it forges nothing.
func StampMediatedUsageDedup(td ptrace.Traces) {
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				if !hasModelSignal(span.Attributes()) {
					continue
				}
				span.Attributes().PutStr(attrSkipTokenAccumulation, "true")
			}
		}
	}
}

// ReparentOTLP rewrites one exported OTLP trace batch so it belongs to the
// conversation's turn:
//
//   - every span's trace id becomes the turn's trace id, so the worker's
//     activity lands in the SAME trace as the app -> control-plane -> manager
//     spans (opencode speaks no W3C propagation; this is where continuity is
//     restored);
//   - every ROOT span (empty parent span id) is parented on the turn's span;
//     non-root spans keep their span ids and parent links, so the worker's own
//     internal hierarchy survives intact;
//   - the resource is stamped with the reserved LangWatch keys
//     (langwatch.thread.id=<conversation>, langwatch.user.id=<acting user>) so
//     the trace is grouped and attributed to the acting user regardless of
//     what the worker set. actorUserID is the manager-held identity, not a
//     worker-supplied attribute. Langy provenance is the origin stamp alone
//     (customerTracePolicy); no label repeats it.
//
// When turn is not (yet) valid — a span batch racing the first turn, or
// telemetry disabled upstream — the batch is forwarded UNMODIFIED apart from
// the resource stamp: an own-trace-id batch in the right project beats a
// dropped one.
//
// Protobuf only: the worker env pins OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf,
// so that is the one wire shape this relay speaks (in and out).
func ReparentOTLP(payload []byte, conversationID, actorUserID string, turn trace.SpanContext) ([]byte, error) {
	td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(payload)
	if err != nil {
		return nil, err
	}
	ReparentTraces(td, conversationID, actorUserID, turn)
	return (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
}

// customerSpanNamePrefixes are the worker span families that carry customer
// meaning — the ai-sdk gen-ai instrumentation the agent runtime emits around
// model calls and tool executions. Everything else opencode exports (storage
// plumbing, session bookkeeping) is operational noise a customer cannot act
// on; it stays out of their project, and — verified live — its dropped
// ancestors were breaking parentage for the spans that DO matter.
var customerSpanNamePrefixes = []string{"ai.", "gen_ai."}

func isCustomerSpanName(name string) bool {
	for _, p := range customerSpanNamePrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// FilterCustomerSpans drops every span outside the customer-meaningful
// families, in place. Runs BEFORE ReparentTraces so the batch-local orphan
// logic sees exactly the set the customer will receive.
func FilterCustomerSpans(td ptrace.Traces) {
	rss := td.ResourceSpans()
	rss.RemoveIf(func(rs ptrace.ResourceSpans) bool {
		rs.ScopeSpans().RemoveIf(func(ss ptrace.ScopeSpans) bool {
			ss.Spans().RemoveIf(func(sp ptrace.Span) bool {
				return !isCustomerSpanName(sp.Name())
			})
			return ss.Spans().Len() == 0
		})
		return rs.ScopeSpans().Len() == 0
	})
}

// ReparentTraces applies the rewrite in place. Split from ReparentOTLP so the
// id-rewriting logic unit-tests against pdata values without codec round-trips.
func ReparentTraces(td ptrace.Traces, conversationID, actorUserID string, turn trace.SpanContext) {
	rss := td.ResourceSpans()
	isTurnValid := turn.IsValid()
	turnTraceID := pcommon.TraceID(turn.TraceID())
	turnSpanID := pcommon.SpanID(turn.SpanID())
	// Span ids present in THIS batch. The worker's exporter emits its span
	// forest across batches and omits some ancestors entirely (verified
	// against opencode's real exports), so a span whose parent is not in the
	// batch would hang off an id the customer's trace may never contain.
	// Batch-local orphans re-parent onto the turn span alongside the roots.
	batchSpanIDs := make(map[pcommon.SpanID]struct{})
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				batchSpanIDs[spans.At(k).SpanID()] = struct{}{}
			}
		}
	}
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		stampResource(rs.Resource().Attributes(), conversationID, actorUserID)
		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			ss := sss.At(j)
			// The provenance strip runs for every batch, including one that
			// arrives before the turn exists: an unreparented batch is still
			// forwarded to the customer, so skipping it here would leave the
			// forgery open on precisely that path.
			stripForgedOrigin(ss.Scope().Attributes())
			spans := ss.Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				stripForgedOrigin(span.Attributes())
				// A billing claim must come from the manager, never the worker:
				// swept on every span, restamped by StampCodexNonBillable only
				// when the manager-held provider really is codex.
				removeAll(span.Attributes(), attrCostNonBillable)
				// The semconv conversation id rides EVERY customer span, not
				// just the resource: the product's thread filters read span
				// attributes (`Attributes['gen_ai.conversation.id']`), and a
				// worker-supplied value would be a thread forgery — swept and
				// restamped like the resource keys. Applies whether or not the
				// turn is known: an unreparented batch is still forwarded.
				removeAll(span.Attributes(), attrGenAIConversationID)
				span.Attributes().PutStr(attrGenAIConversationID, conversationID)
				if !isTurnValid {
					continue
				}
				span.SetTraceID(turnTraceID)
				parent := span.ParentSpanID()
				if _, inBatch := batchSpanIDs[parent]; parent.IsEmpty() || !inBatch {
					span.SetParentSpanID(turnSpanID)
				}
			}
		}
	}
}

// stampResource sets the reserved LangWatch keys. tag.tags is the customer's
// own labeling surface: a worker-set value rides through (deduplicated to its
// leading copy), but the relay adds nothing: the trace's Langy provenance is
// the origin stamp, and a label repeating it would be duplicate signal in the
// trace explorer.
//
// It also REMOVES langwatch.origin: that key is LangWatch's provenance marker
// (pkg/otelsetup stamps platform_internal, the relay's internal copy stamps
// langy_worker) and the worker — a model-driven, prompt-injectable process —
// must not be able to brand its spans with it in the customer's project.
// Ingest-side enforcement keyed on the marker must never trust a
// worker-supplied value.
//
// Every removal here sweeps ALL entries for the key, never just the first.
// The worker writes its own OTLP bytes, and the wire format is a repeated
// list of key/value pairs that the unmarshaler preserves verbatim — so a key
// present twice survives a first-match Remove, and Get/PutStr would read and
// overwrite only the leading copy while the worker's twin rode through
// untouched.
func stampResource(attrs pcommon.Map, conversationID, actorUserID string) {
	removeAll(attrs, attrOrigin)

	tags := firstValue(attrs, attrTags)
	removeAll(attrs, attrThreadID)
	removeAll(attrs, attrGenAIConversationID)
	removeAll(attrs, attrTags)
	// Overwrite, never merge: the acting user is the manager's, and a worker
	// value here would be a spend-attribution forgery. Empty only in partial
	// wiring / tests, where we leave the key unset rather than stamp "".
	removeAll(attrs, attrUserID)
	removeAll(attrs, attrEndUserID)
	if actorUserID != "" {
		attrs.PutStr(attrUserID, actorUserID)
		attrs.PutStr(attrEndUserID, actorUserID)
	}

	attrs.PutStr(attrThreadID, conversationID)
	attrs.PutStr(attrGenAIConversationID, conversationID)
	if tags != "" {
		attrs.PutStr(attrTags, tags)
	}
}

// stripForgedOrigin removes the provenance marker from a span or scope. Ingest
// resolves a span-level langwatch.origin BEFORE falling back to the resource
// (see trace-origin.service.ts), so stripping the resource alone would leave
// the higher-precedence claim in place.
func stripForgedOrigin(attrs pcommon.Map) {
	removeAll(attrs, attrOrigin)
}

// removeAll deletes every entry for key, unlike Map.Remove which returns after
// the first match.
func removeAll(attrs pcommon.Map, key string) {
	attrs.RemoveIf(func(k string, _ pcommon.Value) bool { return k == key })
}

// firstValue returns the leading value for key, or "" when absent. The leading
// copy is the one ingest would have read, so it is the one whose legitimate
// content is preserved when the key is rewritten.
func firstValue(attrs pcommon.Map, key string) string {
	if v, ok := attrs.Get(key); ok {
		return v.AsString()
	}
	return ""
}
