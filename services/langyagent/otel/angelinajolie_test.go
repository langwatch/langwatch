package otel

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

const (
	userPrompt   = "here is my AWS secret AKIAIOSFODNN7EXAMPLE, deploy the staging stack"
	modelReply   = "I have deployed the stack. The admin password is correct-horse-battery."
	toolOutput   = "cat /etc/passwd -> root:x:0:0:root:/root:/bin/bash"
	trustedModel = "gpt-5-mini"
)

func workerBatch(t *testing.T) ptrace.Traces {
	t.Helper()
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "opencode")
	rs.Resource().Attributes().PutStr("customer.internal.hostname", "acme-laptop-01")

	spans := rs.ScopeSpans().AppendEmpty().Spans()
	chat := spans.AppendEmpty()
	chat.SetName("chat worker-supplied-model")
	chat.SetTraceID(pcommon.TraceID([16]byte{9}))
	chat.SetSpanID(pcommon.SpanID([8]byte{1}))
	chat.Attributes().PutStr("gen_ai.operation.name", "chat")
	chat.Attributes().PutStr("gen_ai.system", "openai")
	chat.Attributes().PutStr("gen_ai.request.model", "worker-supplied-model")
	chat.Attributes().PutInt("gen_ai.usage.input_tokens", 42)
	chat.Attributes().PutStr("gen_ai.input.messages", userPrompt)
	chat.Attributes().PutStr("gen_ai.output.messages", modelReply)
	chat.Attributes().PutStr("gen_ai.system_instructions", "You are ACME's agent.")
	chat.Status().SetCode(ptrace.StatusCodeError)
	chat.Status().SetMessage("upstream said: " + modelReply)
	event := chat.Events().AppendEmpty()
	event.SetName("exception")
	event.Attributes().PutStr("exception.message", "failed processing "+userPrompt)

	tool := spans.AppendEmpty()
	tool.SetName("tool.bash")
	tool.SetTraceID(pcommon.TraceID([16]byte{9}))
	tool.SetSpanID(pcommon.SpanID([8]byte{2}))
	tool.SetParentSpanID(pcommon.SpanID([8]byte{1}))
	tool.Attributes().PutStr("gen_ai.tool.name", "bash")
	tool.Attributes().PutStr("gen_ai.tool.type", "function")
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

func spanAttrsAt(td ptrace.Traces, index int) map[string]string {
	got := map[string]string{}
	span := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(index)
	span.Attributes().Range(func(key string, value pcommon.Value) bool {
		got[key] = value.AsString()
		return true
	})
	return got
}

func marshalTraces(t *testing.T, td ptrace.Traces) []byte {
	t.Helper()
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	require.NoError(t, err)
	return payload
}

func TestInternalCopy_StripsPromptCompletionAndToolContent(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", trustedModel, turnContext(t))
	payload := marshalTraces(t, out)

	for _, secret := range []string{userPrompt, modelReply, toolOutput} {
		assert.NotContains(t, string(payload), secret, "worker content reached LangWatch's copy")
	}
}

func TestInternalCopy_DropsUnrecognisedAttributes(t *testing.T) {
	td := workerBatch(t)
	td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0).
		Attributes().PutStr("gen_ai.some.future.key", userPrompt)

	out := InternalCopy(td, "conv-1", trustedModel, turnContext(t))

	assert.NotContains(t, spanAttrsAt(out, 0), "gen_ai.some.future.key")
}

func TestInternalCopy_KeepsOnlyTrustedOperationalMetadata(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", trustedModel, turnContext(t))

	chat := spanAttrsAt(out, 0)
	assert.Equal(t, trustedModel, chat["gen_ai.request.model"])
	assert.Equal(t, "42", chat["gen_ai.usage.input_tokens"])
	assert.Equal(t, "chat", chat["gen_ai.operation.name"])
	assert.Equal(t, "openai", chat["gen_ai.system"])

	tool := spanAttrsAt(out, 1)
	assert.Equal(t, "function", tool["gen_ai.tool.type"])
	assert.NotContains(t, tool, "gen_ai.tool.name", "worker-controlled tool names are content carriers")
	assert.NotContains(t, tool, "gen_ai.tool.arguments")
	assert.NotContains(t, tool, "gen_ai.tool.result")
}

func TestInternalCopy_PreservesHTTPSpanLatencyMetadata(t *testing.T) {
	td := workerBatch(t)
	source := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(1)
	source.SetKind(ptrace.SpanKindClient)
	source.SetStartTimestamp(pcommon.Timestamp(1_000_000_000))
	source.SetEndTimestamp(pcommon.Timestamp(1_350_000_000))
	source.Attributes().PutStr("http.request.method", "POST")
	source.Attributes().PutInt("http.response.status_code", 201)

	out := InternalCopy(td, "conv-1", trustedModel, turnContext(t))
	span := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(1)
	attrs := spanAttrsAt(out, 1)

	assert.Equal(t, ptrace.SpanKindClient, span.Kind())
	assert.Equal(t, source.StartTimestamp(), span.StartTimestamp())
	assert.Equal(t, source.EndTimestamp(), span.EndTimestamp())
	assert.Equal(t, "POST", attrs["http.request.method"])
	assert.Equal(t, "201", attrs["http.response.status_code"])
}

func TestInternalCopy_RejectsEveryFreeFormOTLPCarrier(t *testing.T) {
	const secret = "customer-secret-abcdef"
	td := workerBatch(t)
	rs := td.ResourceSpans().At(0)
	rs.SetSchemaUrl("https://" + secret + "/resource")
	rs.Resource().Attributes().PutStr("secret.resource", secret)

	ss := rs.ScopeSpans().At(0)
	ss.SetSchemaUrl("https://" + secret + "/scope")
	ss.Scope().SetName(secret)
	ss.Scope().SetVersion(secret)
	ss.Scope().Attributes().PutStr("secret.scope", secret)

	span := ss.Spans().At(0)
	span.SetName(secret)
	span.TraceState().FromRaw("vendor=" + secret)
	span.Attributes().PutStr("gen_ai.request.model", secret)
	span.Attributes().PutStr("gen_ai.system", secret)
	span.Status().SetMessage(secret)
	event := span.Events().AppendEmpty()
	event.SetName(secret)
	event.Attributes().PutStr("secret.event", secret)
	link := span.Links().AppendEmpty()
	link.SetTraceID(pcommon.TraceID([16]byte{3}))
	link.SetSpanID(pcommon.SpanID([8]byte{4}))
	link.TraceState().FromRaw("vendor=" + secret)
	link.Attributes().PutStr("secret.link", secret)

	out := InternalCopy(td, "conv-safe", trustedModel, turnContext(t))
	payload := marshalTraces(t, out)
	assert.False(t, bytes.Contains(payload, []byte(secret)), "a worker-controlled string survived the boundary")

	outRS := out.ResourceSpans().At(0)
	outSS := outRS.ScopeSpans().At(0)
	outSpan := outSS.Spans().At(0)
	assert.Empty(t, outRS.SchemaUrl())
	assert.Empty(t, outSS.SchemaUrl())
	assert.Equal(t, internalScopeName, outSS.Scope().Name())
	assert.Empty(t, outSS.Scope().Version())
	assert.Zero(t, outSS.Scope().Attributes().Len())
	assert.Equal(t, internalSpanName, outSpan.Name())
	assert.Empty(t, outSpan.TraceState().AsRaw())
	assert.Zero(t, outSpan.Events().Len())
	assert.Empty(t, outSpan.Status().Message())
	assert.Zero(t, outSpan.Links().Len(), "worker-controlled links must not cross the boundary")
}

func TestInternalCopy_ReplacesWorkerResourceWithOurIdentity(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", trustedModel, turnContext(t))

	attrs := out.ResourceSpans().At(0).Resource().Attributes()
	got := map[string]string{}
	attrs.Range(func(key string, value pcommon.Value) bool {
		got[key] = value.AsString()
		return true
	})

	assert.Equal(t, serviceName, got[attrServiceName])
	assert.Equal(t, originWorker, got[attrOrigin])
	assert.Equal(t, "conv-1", got[attrConversation])
	assert.NotContains(t, got, "customer.internal.hostname")
}

func TestInternalCopy_DoesNotMutateTheCustomerBatch(t *testing.T) {
	td := workerBatch(t)
	before := marshalTraces(t, td)

	_ = InternalCopy(td, "conv-1", trustedModel, turnContext(t))

	assert.Equal(t, before, marshalTraces(t, td))
}

func TestInternalCopy_ReparentsOntoTheTurn(t *testing.T) {
	turn := turnContext(t)
	out := InternalCopy(workerBatch(t), "conv-1", trustedModel, turn)

	spans := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	for i := 0; i < spans.Len(); i++ {
		assert.Equal(t, pcommon.TraceID(turn.TraceID()), spans.At(i).TraceID())
		assert.Equal(t, pcommon.SpanID(turn.SpanID()), spans.At(i).ParentSpanID())
	}
	assert.NotEqual(t, pcommon.SpanID([8]byte{1}), spans.At(0).SpanID())
	assert.NotEqual(t, pcommon.SpanID([8]byte{2}), spans.At(1).SpanID())
}

func TestInternalCopy_RegeneratesWorkerIDsWithoutATurn(t *testing.T) {
	out := InternalCopy(workerBatch(t), "conv-1", trustedModel, trace.SpanContext{})

	spans := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
	assert.NotEqual(t, pcommon.TraceID([16]byte{9}), spans.At(0).TraceID())
	assert.NotEqual(t, pcommon.SpanID([8]byte{1}), spans.At(0).SpanID())
	assert.NotEqual(t, pcommon.SpanID([8]byte{2}), spans.At(1).SpanID())
	assert.Equal(t, spans.At(0).TraceID(), spans.At(1).TraceID())
	assert.Empty(t, spans.At(0).ParentSpanID())
	assert.Empty(t, spans.At(1).ParentSpanID())
	assert.NotContains(t, string(marshalTraces(t, out)), userPrompt)
}
