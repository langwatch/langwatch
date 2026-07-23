package otel

import (
	"strings"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

// The mirror lane (ADR-061) is a SECOND, distinct copy from the ops collector
// copy that InternalCopy builds. Where InternalCopy is a blank-tree, fail-closed
// rebuild that strips everything the ops collector must never see, the mirror is
// FULL FIDELITY: LangWatch runs Langy as a product and reads its own turns the
// way a customer reads theirs, so the mirror preserves span names, the worker's
// own parent/child hierarchy, timings, status and every operational attribute.
//
// Only two things are treated specially, and neither is "scrubbing operational
// data":
//
//   - CONTENT bodies — prompts, completions, tool payloads — ride ONLY at the
//     content tier. The structural tier removes exactly this closed set of keys
//     and nothing else, so a restricted customer's mirror still carries the full
//     operational shape of the turn but none of its content.
//   - The worker's forged platform-provenance markers are stripped and replaced
//     with LangWatch's own. A worker is model-driven and prompt-injectable; it
//     must not be able to brand its spans as platform-internal, least of all in
//     LangWatch's own project.
//
// Contrast the customer forward, which scrubs everything EXCEPT the customer's
// own content (their agent, their prompts) down to the ai.*/gen_ai.* spans. The
// mirror is the inverse posture: scrub nothing, and gate only the content on the
// customer's tier.

// mirrorContentKeys is the closed set of span-attribute keys that carry customer
// content on a worker span. At the structural tier these are the ONLY keys the
// mirror removes; everything else about the span travels. Enumerated from the
// worker's real gen_ai spans (see otel/angelinajolie_test.go and the ai-sdk
// instrumentation the agent runtime emits) — the message bodies, the system
// prompt, and the tool call's name/arguments/result, each a content carrier.
// Adding a NEW content attribute here is the deliberate act the fail-closed
// doctrine asks for: a content key nobody listed is NOT stripped at the
// structural tier, so this list is the structural tier's content guarantee.
var mirrorContentKeys = []string{
	"gen_ai.input.messages",
	"gen_ai.output.messages",
	"gen_ai.system_instructions",
	"gen_ai.prompt",
	"gen_ai.completion",
	"gen_ai.tool.name",
	"gen_ai.tool.arguments",
	"gen_ai.tool.result",
}

// MirrorParams is everything MirrorCopy needs beyond the batch itself. The
// trusted model + conversation id are manager-owned (never read from the
// worker's OTLP); the source org/project are the customer tenant the turn ran
// for, stamped for per-customer attribution (ADR-061 §5 / ADR-053 Track A).
type MirrorParams struct {
	ConversationID  string
	TrustedModel    string
	Turn            trace.SpanContext
	SourceOrgID     string
	SourceProjectID string
	IncludeContent  bool
}

// MirrorCopy builds LangWatch's mirror copy of one worker batch at the fidelity
// the customer's tier allows. td is not modified; the returned batch is a full
// deep copy with the mirror's stamps applied and — at the structural tier — the
// content keys removed.
func MirrorCopy(td ptrace.Traces, p MirrorParams) ptrace.Traces {
	out := ptrace.NewTraces()
	// Deep copy first: the mirror keeps the worker's tree verbatim, then adjusts
	// it. This is the "scrub nothing" default — the opposite construction to
	// InternalCopy, which starts blank and copies in only an allowlist.
	td.CopyTo(out)

	reparentPreservingHierarchy(out, p.Turn)

	rss := out.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		stampMirrorResource(rs.Resource().Attributes(), p)
		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			ss := sss.At(j)
			stripMirrorForgedOrigin(ss.Scope().Attributes())
			spans := ss.Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				attrs := span.Attributes()
				stripMirrorForgedOrigin(attrs)
				substituteTrustedModel(attrs, p.TrustedModel)
				if !p.IncludeContent {
					stripContent(attrs)
				}
			}
		}
	}
	return out
}

// reparentPreservingHierarchy rewrites every span's trace id to the turn's and
// re-parents batch-root/orphan spans onto the turn span, KEEPING the worker's
// internal parent/child links — so the mirror shows the same call tree the
// customer sees. No-op when the turn context is not yet valid (a batch racing
// the first turn), leaving the worker's own ids so the batch is at least
// self-consistent.
//
// The same orphan-aware rule the customer forward applies in
// otelrelay.ReparentTraces; kept here rather than shared across the package
// boundary because the two lanes stamp entirely different resources around it.
func reparentPreservingHierarchy(td ptrace.Traces, turn trace.SpanContext) {
	if !turn.IsValid() {
		return
	}
	turnTraceID := pcommon.TraceID(turn.TraceID())
	turnSpanID := pcommon.SpanID(turn.SpanID())

	batchSpanIDs := map[pcommon.SpanID]struct{}{}
	forEachMirrorSpan(td, func(sp ptrace.Span) {
		batchSpanIDs[sp.SpanID()] = struct{}{}
	})
	forEachMirrorSpan(td, func(sp ptrace.Span) {
		sp.SetTraceID(turnTraceID)
		parent := sp.ParentSpanID()
		if _, inBatch := batchSpanIDs[parent]; parent.IsEmpty() || !inBatch {
			sp.SetParentSpanID(turnSpanID)
		}
	})
}

func forEachMirrorSpan(td ptrace.Traces, fn func(ptrace.Span)) {
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				fn(spans.At(k))
			}
		}
	}
}

// stampMirrorResource applies the mirror's own provenance + attribution to a
// resource, keeping every other attribute (worker pod, sdk metadata, …) intact
// — the "scrub nothing" posture. It:
//
//   - replaces any worker-supplied langwatch.origin with "langy", so the mirror
//     trace resolves to Langy in LangWatch's own project (a prompt-injectable
//     worker must not choose the provenance marker);
//   - replaces a platform-impersonating service.name with "langy", leaving a
//     legitimate worker service.name ("opencode") untouched;
//   - labels the trace "langy" (tag.tags) and groups it by conversation
//     (langwatch.thread.id);
//   - stamps the SOURCE tenant (organization + project) for per-customer
//     attribution — mirror-only, never on the customer's own trace.
func stampMirrorResource(attrs pcommon.Map, p MirrorParams) {
	removeAllMirror(attrs, attrOrigin)
	attrs.PutStr(attrOrigin, mirrorOrigin)

	if name, ok := attrs.Get(attrServiceName); ok && isPlatformImpersonation(name.Str()) {
		removeAllMirror(attrs, attrServiceName)
		attrs.PutStr(attrServiceName, mirrorPlatformService)
	}

	tags := firstMirrorValue(attrs, mirrorTagsKey)
	removeAllMirror(attrs, mirrorTagsKey)
	switch {
	case tags == "":
		attrs.PutStr(mirrorTagsKey, langyLabel)
	case mirrorTagsContain(tags, langyLabel):
		attrs.PutStr(mirrorTagsKey, tags)
	default:
		attrs.PutStr(mirrorTagsKey, tags+","+langyLabel)
	}

	removeAllMirror(attrs, mirrorThreadKey)
	attrs.PutStr(mirrorThreadKey, p.ConversationID)
	attrs.PutStr(attrConversation, p.ConversationID)

	// Source-tenant attribution. Stamped ONLY here (the mirror goes to
	// LangWatch), never on the customer forward — the destination is what makes
	// these safe to carry. Absent values leave the key unset rather than stamp
	// an empty string.
	if p.SourceOrgID != "" {
		removeAllMirror(attrs, mirrorSourceOrgKey)
		attrs.PutStr(mirrorSourceOrgKey, p.SourceOrgID)
	}
	if p.SourceProjectID != "" {
		removeAllMirror(attrs, mirrorSourceProjectKey)
		attrs.PutStr(mirrorSourceProjectKey, p.SourceProjectID)
	}
}

// substituteTrustedModel replaces the worker-supplied model string with the
// manager-owned one on both request and response, when present. The worker's
// value is an arbitrary string that may carry content; the trusted value is the
// model the manager actually configured. A substitution, not a scrub — the
// mirror still shows a model.
func substituteTrustedModel(attrs pcommon.Map, trustedModel string) {
	if trustedModel == "" {
		return
	}
	for _, key := range []string{"gen_ai.request.model", "gen_ai.response.model"} {
		if _, ok := attrs.Get(key); ok {
			attrs.PutStr(key, trustedModel)
		}
	}
}

// stripContent removes exactly the content-carrier keys for the structural
// tier. Every removal sweeps ALL entries for the key (the worker writes its own
// OTLP and may repeat a key), so a duplicated content attribute cannot ride
// through on a first-match delete.
func stripContent(attrs pcommon.Map) {
	for _, key := range mirrorContentKeys {
		removeAllMirror(attrs, key)
	}
}

func stripMirrorForgedOrigin(attrs pcommon.Map) {
	removeAllMirror(attrs, attrOrigin)
}

const (
	// mirrorOrigin is the provenance value the mirror stamps so its traces
	// resolve to Langy in LangWatch's own project (matches the customer lane's
	// originLangy). Distinct from InternalCopy's originWorker, which marks the
	// content-stripped ops copy.
	mirrorOrigin          = "langy"
	mirrorPlatformService = "langy"
	mirrorTagsKey         = "tag.tags"
	mirrorThreadKey       = "langwatch.thread.id"
	langyLabel            = "langy"
	// Source-tenant attribution keys (ADR-053 Track A: organization + project
	// identifiers). The same key convention the gateway's own tracer uses
	// (services/aigateway/adapters/gatewaytracer/attrs.go); on the mirror they
	// name the SOURCE customer tenant the turn ran for.
	mirrorSourceOrgKey     = "langwatch.organization_id"
	mirrorSourceProjectKey = "langwatch.project_id"
)

// isPlatformImpersonation reports whether a worker-supplied service.name claims
// a platform identity (any langwatch-* variant, or "langy"), under case folding
// and -/_ normalization — the same rule the customer forward applies.
func isPlatformImpersonation(name string) bool {
	n := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(name)), "_", "-")
	return strings.HasPrefix(n, "langwatch") || n == "langy"
}

func removeAllMirror(attrs pcommon.Map, key string) {
	attrs.RemoveIf(func(k string, _ pcommon.Value) bool { return k == key })
}

func firstMirrorValue(attrs pcommon.Map, key string) string {
	if v, ok := attrs.Get(key); ok {
		return v.AsString()
	}
	return ""
}

func mirrorTagsContain(csv, tag string) bool {
	for _, t := range strings.Split(csv, ",") {
		if strings.TrimSpace(t) == tag {
			return true
		}
	}
	return false
}
