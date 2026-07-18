// Package otel builds LangWatch's OWN copy of a Langy worker's telemetry.
//
// A worker's OTLP batch goes to the customer's project verbatim — it is their
// agent, their prompts, their project. That path is untouched by this package.
//
// LangWatch also needs operational visibility into workers it runs: which model,
// how many tokens, how long, what failed. It must NOT receive the content. The
// worker is an opencode subprocess and its spans are the highest-density
// prompt/completion surface in the system — the relay already accepts-and-drops
// worker LOGS and METRICS for exactly that reason, but spans were never filtered
// because they only ever went to the customer.
//
// InternalCopy is the boundary. It deep-copies the batch, keeps a strict
// allowlist of shape-and-cost attributes, drops every span event (the classic
// carrier: exception.message, exception.stacktrace, gen_ai prompt/completion
// events), clears status descriptions (provider error text), and replaces the
// worker's resource with LangWatch's own service identity.
//
// The allowlist is deliberate: a denylist fails open on the next key opencode's
// instrumentation invents, and the whole point is that unknown keys are assumed
// to carry content.
package otel

import (
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

// Resource keys stamped on LangWatch's copy. The worker's own resource
// attributes are discarded wholesale rather than filtered — they describe the
// customer's agent, and we are re-attributing this batch to our own service.
const (
	attrServiceName  = "service.name"
	attrOrigin       = "langwatch.origin"
	attrConversation = "langy.conversation_id"

	serviceName  = "langwatch-langyworker"
	originWorker = "langy_worker"
)

// spanAttributeAllowlist is the complete set of span attributes LangWatch's
// copy may carry. Everything absent here is dropped, including keys that look
// harmless — an unrecognised key is assumed to carry content until someone
// deliberately adds it, with a test.
//
// Note what is NOT here: gen_ai.input.messages, gen_ai.output.messages,
// gen_ai.system_instructions, gen_ai.prompt, gen_ai.completion, and every tool
// argument or result key. Those are the customer's.
var spanAttributeAllowlist = map[string]struct{}{
	// Shape of the call.
	"gen_ai.operation.name":  {},
	"gen_ai.system":          {},
	"gen_ai.request.model":   {},
	"gen_ai.response.model":  {},
	"gen_ai.conversation.id": {},

	// Cost and size. Counts, never content.
	"gen_ai.usage.input_tokens":                {},
	"gen_ai.usage.output_tokens":               {},
	"gen_ai.usage.total_tokens":                {},
	"gen_ai.usage.cache_read.input_tokens":     {},
	"gen_ai.usage.cache_creation.input_tokens": {},

	// Outcome. finish_reasons is a fixed vocabulary ("stop", "length", ...);
	// error.type is a classifier token, not a message.
	"gen_ai.response.finish_reasons": {},
	"error.type":                     {},

	// Tool identity — which tool ran, never what it was called with or returned.
	"gen_ai.tool.name":    {},
	"gen_ai.tool.type":    {},
	"gen_ai.tool.call.id": {},

	// Transport shape. url.full and query strings are excluded on purpose:
	// agent traffic routinely carries content in them.
	"http.request.method":       {},
	"http.response.status_code": {},
	"server.address":            {},
}

// InternalCopy returns LangWatch's content-stripped copy of a worker OTLP
// batch, re-parented under the turn so it joins the manager's own trace.
//
// td is NOT modified — the caller's batch stays intact for the customer path.
// Re-parenting onto the turn is legitimate here in a way it is not for the
// customer copy: this trace lives in LangWatch's backend, where the turn's
// parent span actually exists.
func InternalCopy(td ptrace.Traces, conversationID string, turn trace.SpanContext) ptrace.Traces {
	out := ptrace.NewTraces()
	td.CopyTo(out)

	rss := out.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		stampInternalResource(rs.Resource().Attributes(), conversationID)

		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				sanitizeSpan(spans.At(k), turn)
			}
		}
	}
	return out
}

// stampInternalResource discards the worker's resource attributes and replaces
// them with LangWatch's service identity. Clearing rather than filtering keeps
// customer-set resource attributes (which opencode lets the agent influence)
// out of our backend entirely.
func stampInternalResource(attrs pcommon.Map, conversationID string) {
	attrs.Clear()
	attrs.PutStr(attrServiceName, serviceName)
	attrs.PutStr(attrOrigin, originWorker)
	attrs.PutStr(attrConversation, conversationID)
}

func sanitizeSpan(span ptrace.Span, turn trace.SpanContext) {
	span.Attributes().RemoveIf(func(k string, _ pcommon.Value) bool {
		_, allowed := spanAttributeAllowlist[k]
		return !allowed
	})

	// Events carry exception.message / exception.stacktrace and, in several
	// gen_ai instrumentations, the prompt and completion bodies themselves.
	// None of it is worth the risk operationally.
	span.Events().RemoveIf(func(ptrace.SpanEvent) bool { return true })

	// Link attributes are attacker-influenced the same way span attributes are;
	// the link's trace/span ids are the useful part.
	links := span.Links()
	for i := 0; i < links.Len(); i++ {
		links.At(i).Attributes().Clear()
	}

	// Status descriptions are raw provider/runtime error text. Keep the code.
	span.Status().SetMessage("")

	if turn.IsValid() {
		span.SetTraceID(pcommon.TraceID(turn.TraceID()))
		if span.ParentSpanID().IsEmpty() {
			span.SetParentSpanID(pcommon.SpanID(turn.SpanID()))
		}
	}
}
