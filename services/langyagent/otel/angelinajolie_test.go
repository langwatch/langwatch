package otel

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

const (
	userPrompt = "here is my AWS secret AKIAIOSFODNN7EXAMPLE, deploy the staging stack"
	modelReply = "I have deployed the stack. The admin password is correct-horse-battery."
	toolOutput = "cat /etc/passwd -> root:x:0:0:root:/root:/bin/bash"
)

// workerBatch is a realistic opencode export: a gen_ai span carrying prompt and
// completion bodies, a tool span carrying its arguments and result, an exception
// event, a status description, and worker-set resource attributes.
func workerBatch(t *testing.T) ptrace.Traces {
	t.Helper()
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "opencode")
	rs.Resource().Attributes().PutStr("customer.internal.hostname", "acme-laptop-01")

	spans := rs.ScopeSpans().AppendEmpty().Spans()

	chat := spans.AppendEmpty()
	chat.SetName("chat gpt-5-mini")
	chat.SetTraceID(pcommon.TraceID([16]byte{9}))
	chat.SetSpanID(pcommon.SpanID([8]byte{1}))
	chat.Attributes().PutStr("gen_ai.request.model", "gpt-5-mini")
	chat.Attributes().PutInt("gen_ai.usage.input_tokens", 42)
	chat.Attributes().PutStr("gen_ai.input.messages", userPrompt)
	chat.Attributes().PutStr("gen_ai.output.messages", modelReply)
	chat.Attributes().PutStr("gen_ai.system_instructions", "You are ACME's agent.")
	chat.Status().SetMessage("upstream said: " + modelReply)
	ev := chat.Events().AppendEmpty()
	ev.SetName("exception")
	ev.Attributes().PutStr("exception.message", "failed processing "+userPrompt)

	tool := spans.AppendEmpty()
	tool.SetName("tool.bash")
	tool.SetTraceID(pcommon.TraceID([16]byte{9}))
	tool.SetSpanID(pcommon.SpanID([8]byte{2}))
	tool.SetParentSpanID(pcommon.SpanID([8]byte{1}))
	tool.Attributes().PutStr("gen_ai.tool.name", "bash")
	tool.Attributes().PutStr("gen_ai.tool.arguments", "cat /etc/passwd")
	tool.Attributes().PutStr("gen_ai.tool.result", toolOutput)

	return td
}

func turnContext(t *testing.T) trace.SpanContext {
	t.Helper()
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID([16]byte{7}),
		SpanID:  trace.SpanID([8]byte{7}),
	})
}

// allValues returns every attribute value in the batch, flattened, so a test
// can assert on content regardless of which key it hid under.
func allValues(td ptrace.Traces) []string {
	var out []string
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		rs.Resource().Attributes().Range(func(_ string, v pcommon.Value) bool {
			out = append(out, v.AsString())
			return true
		})
		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				span := spans.At(k)
				out = append(out, span.Name(), span.Status().Message())
				span.Attributes().Range(func(_ string, v pcommon.Value) bool {
					out = append(out, v.AsString())
					return true
				})
				evs := span.Events()
				for e := 0; e < evs.Len(); e++ {
					evs.At(e).Attributes().Range(func(_ string, v pcommon.Value) bool {
						out = append(out, v.AsString())
						return true
					})
				}
			}
		}
	}
	return out
}

func spanAttrs(td ptrace.Traces, name string) map[string]string {
	got := map[string]string{}
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				if spans.At(k).Name() != name {
					continue
				}
				spans.At(k).Attributes().Range(func(key string, v pcommon.Value) bool {
					got[key] = v.AsString()
					return true
				})
			}
		}
	}
	return got
}

func TestInternalCopy_StripsPromptCompletionAndToolContent(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", turnContext(t))

	for _, value := range allValues(out) {
		for _, secret := range []string{userPrompt, modelReply, toolOutput} {
			assert.NotContains(t, value, secret,
				"worker content reached LangWatch's own copy")
		}
	}
}

// The fail-closed property. A key nobody anticipated must be dropped, not kept:
// a denylist would ship it.
func TestInternalCopy_DropsUnrecognisedAttributes(t *testing.T) {
	td := workerBatch(t)
	td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0).
		Attributes().PutStr("gen_ai.some.future.key", userPrompt)

	out := InternalCopy(td, "conv-1", turnContext(t))

	assert.NotContains(t, spanAttrs(out, "chat gpt-5-mini"), "gen_ai.some.future.key",
		"an unrecognised key must be dropped, not forwarded")
}

func TestInternalCopy_KeepsOperationalMetadata(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", turnContext(t))

	chat := spanAttrs(out, "chat gpt-5-mini")
	assert.Equal(t, "gpt-5-mini", chat["gen_ai.request.model"])
	assert.Equal(t, "42", chat["gen_ai.usage.input_tokens"])

	tool := spanAttrs(out, "tool.bash")
	assert.Equal(t, "bash", tool["gen_ai.tool.name"], "which tool ran is operational")
	assert.NotContains(t, tool, "gen_ai.tool.arguments", "what it ran is content")
	assert.NotContains(t, tool, "gen_ai.tool.result", "what it returned is content")
}

func TestInternalCopy_DropsAllSpanEvents(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", turnContext(t))

	spans := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	for i := 0; i < spans.Len(); i++ {
		assert.Zero(t, spans.At(i).Events().Len(),
			"span events carry exception text and prompt bodies")
	}
}

func TestInternalCopy_ClearsStatusMessage(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", turnContext(t))

	spans := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	for i := 0; i < spans.Len(); i++ {
		assert.Empty(t, spans.At(i).Status().Message(),
			"status descriptions are raw provider text")
	}
}

func TestInternalCopy_ReplacesWorkerResourceWithOurIdentity(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", turnContext(t))

	attrs := out.ResourceSpans().At(0).Resource().Attributes()
	got := map[string]string{}
	attrs.Range(func(k string, v pcommon.Value) bool { got[k] = v.AsString(); return true })

	assert.Equal(t, serviceName, got[attrServiceName])
	assert.Equal(t, originWorker, got[attrOrigin])
	assert.Equal(t, "conv-1", got[attrConversation])
	assert.NotContains(t, got, "customer.internal.hostname",
		"worker-set resource attributes must not reach our backend")
}

// The customer's batch must be byte-for-byte what it was before — their path is
// not degraded by our copy existing.
func TestInternalCopy_DoesNotMutateTheCustomerBatch(t *testing.T) {
	td := workerBatch(t)
	before, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	require.NoError(t, err)

	_ = InternalCopy(td, "conv-1", turnContext(t))

	after, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	require.NoError(t, err)
	assert.Equal(t, before, after, "the customer-bound batch was mutated by our copy")
}

func TestInternalCopy_ReparentsOntoTheTurn(t *testing.T) {
	turn := turnContext(t)

	out := InternalCopy(workerBatch(t), "conv-1", turn)

	spans := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	for i := 0; i < spans.Len(); i++ {
		assert.Equal(t, pcommon.TraceID(turn.TraceID()), spans.At(i).TraceID())
	}
	// The root span adopts the turn span; the child keeps its own parent.
	assert.Equal(t, pcommon.SpanID(turn.SpanID()), spans.At(0).ParentSpanID())
	assert.Equal(t, pcommon.SpanID([8]byte{1}), spans.At(1).ParentSpanID(),
		"the worker's internal hierarchy must survive")
}

func TestInternalCopy_LeavesIDsAloneWithoutATurn(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", trace.SpanContext{})

	span := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
	assert.Equal(t, pcommon.TraceID([16]byte{9}), span.TraceID())
	// Stripping still happened even though re-parenting did not.
	for _, value := range allValues(out) {
		assert.False(t, strings.Contains(value, userPrompt),
			"content must be stripped regardless of turn validity")
	}
}
