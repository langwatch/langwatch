package otel

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/trace"
)

const (
	mirrorPrompt     = "my api key is sk-live-abc123 and the patient is Jane Doe"
	mirrorCompletion = "the patient record has been summarized"
	mirrorToolArgs   = "cat /etc/passwd"
	mirrorToolResult = "root:x:0:0:root:/root:/bin/bash"
	mirrorSysPrompt  = "You are ACME's internal agent."
	// A content-bearing attribute NOT in mirrorContentKeys — the "newly
	// introduced attribute" case the tier tests probe.
	novelContentKey = "gen_ai.future.reasoning"
	novelContentVal = "the model privately reasoned about the patient"
)

// mirrorWorkerBatch is a two-span worker batch carrying the full operational +
// content surface a real turn produces: a model call and a tool call, on a
// resource that also carries worker infra identity and a FORGED platform origin.
func mirrorWorkerBatch(t *testing.T) ptrace.Traces {
	t.Helper()
	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	res := rs.Resource().Attributes()
	res.PutStr("service.name", "opencode")
	res.PutStr("k8s.pod.name", "langy-worker-7")
	res.PutStr("telemetry.sdk.name", "opentelemetry")
	// A prompt-injectable worker branding itself platform-internal.
	res.PutStr("langwatch.origin", "platform_internal")

	ss := rs.ScopeSpans().AppendEmpty()
	ss.Scope().SetName("ai")

	chat := ss.Spans().AppendEmpty()
	chat.SetName("ai.streamText")
	chat.SetKind(ptrace.SpanKindClient)
	chat.SetSpanID(pcommon.SpanID{1})
	chat.Attributes().PutStr("gen_ai.request.model", "worker-supplied-model")
	chat.Attributes().PutInt("gen_ai.usage.input_tokens", 42)
	chat.Attributes().PutStr("gen_ai.input.messages", mirrorPrompt)
	chat.Attributes().PutStr("gen_ai.output.messages", mirrorCompletion)
	chat.Attributes().PutStr("gen_ai.system_instructions", mirrorSysPrompt)
	chat.Attributes().PutStr(novelContentKey, novelContentVal)

	tool := ss.Spans().AppendEmpty()
	tool.SetName("ai.toolCall")
	tool.SetSpanID(pcommon.SpanID{2})
	tool.SetParentSpanID(pcommon.SpanID{1}) // preserve worker hierarchy
	tool.Attributes().PutStr("gen_ai.tool.name", "bash")
	tool.Attributes().PutStr("gen_ai.tool.arguments", mirrorToolArgs)
	tool.Attributes().PutStr("gen_ai.tool.result", mirrorToolResult)

	return td
}

func mirrorTurn() trace.SpanContext {
	return trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{0xaa},
		SpanID:  trace.SpanID{0xbb},
	})
}

// spanByName finds the first span with the given name across the batch.
func spanByName(td ptrace.Traces, name string) (ptrace.Span, bool) {
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			for k := 0; k < spans.Len(); k++ {
				if spans.At(k).Name() == name {
					return spans.At(k), true
				}
			}
		}
	}
	return ptrace.Span{}, false
}

func mirrorResourceAttrs(td ptrace.Traces) pcommon.Map {
	return td.ResourceSpans().At(0).Resource().Attributes()
}

func str(m pcommon.Map, key string) (string, bool) {
	v, ok := m.Get(key)
	if !ok {
		return "", false
	}
	return v.AsString(), true
}

func TestMirrorCopy_Attribution(t *testing.T) {
	out := MirrorCopy(mirrorWorkerBatch(t), MirrorParams{
		ConversationID:  "conv-1",
		TrustedModel:    "openai/gpt-5-mini",
		Turn:            mirrorTurn(),
		SourceOrgID:     "org-acme",
		SourceProjectID: "proj-acme",
		IncludeContent:  true,
	})
	res := mirrorResourceAttrs(out)

	t.Run("stamps the source tenant for per-customer attribution", func(t *testing.T) {
		org, ok := str(res, "langwatch.organization_id")
		require.True(t, ok, "source organization must be stamped on the mirror")
		assert.Equal(t, "org-acme", org)
		proj, ok := str(res, "langwatch.project_id")
		require.True(t, ok, "source project must be stamped on the mirror")
		assert.Equal(t, "proj-acme", proj)
	})

	t.Run("replaces a worker-forged origin with langy", func(t *testing.T) {
		origin, ok := str(res, "langwatch.origin")
		require.True(t, ok)
		assert.Equal(t, "langy", origin,
			"a prompt-injectable worker must not brand the mirror as platform_internal")
	})

	t.Run("groups the trace by conversation without a langy label", func(t *testing.T) {
		_, hasTags := res.Get("tag.tags")
		assert.False(t, hasTags,
			"the origin stamp is the Langy signal; a label repeating it is duplicate noise")
		thread, _ := str(res, "langwatch.thread.id")
		assert.Equal(t, "conv-1", thread)
	})

	t.Run("omits attribution when the source tenant is unknown", func(t *testing.T) {
		out := MirrorCopy(mirrorWorkerBatch(t), MirrorParams{
			ConversationID: "conv-1",
			Turn:           mirrorTurn(),
			IncludeContent: true,
		})
		res := mirrorResourceAttrs(out)
		_, hasOrg := res.Get("langwatch.organization_id")
		_, hasProj := res.Get("langwatch.project_id")
		assert.False(t, hasOrg, "an empty org must leave the key unset, not stamp \"\"")
		assert.False(t, hasProj, "an empty project must leave the key unset, not stamp \"\"")
	})
}

func TestMirrorCopy_Tiers(t *testing.T) {
	// Content keys the customer's own trace carries; the content tier keeps them,
	// the structural tier removes them.
	contentAttrs := map[string]struct {
		span, key, want string
	}{
		"input messages":      {"ai.streamText", "gen_ai.input.messages", mirrorPrompt},
		"output messages":     {"ai.streamText", "gen_ai.output.messages", mirrorCompletion},
		"system instructions": {"ai.streamText", "gen_ai.system_instructions", mirrorSysPrompt},
		"tool name":           {"ai.toolCall", "gen_ai.tool.name", "bash"},
		"tool arguments":      {"ai.toolCall", "gen_ai.tool.arguments", mirrorToolArgs},
		"tool result":         {"ai.toolCall", "gen_ai.tool.result", mirrorToolResult},
	}

	t.Run("when the tier is content", func(t *testing.T) {
		out := MirrorCopy(mirrorWorkerBatch(t), MirrorParams{
			ConversationID: "conv-1", TrustedModel: "openai/gpt-5-mini",
			Turn: mirrorTurn(), IncludeContent: true,
		})

		t.Run("carries every content key the customer sees", func(t *testing.T) {
			for name, c := range contentAttrs {
				span, ok := spanByName(out, c.span)
				require.True(t, ok, "%s: span %q missing", name, c.span)
				got, ok := str(span.Attributes(), c.key)
				require.True(t, ok, "%s: %q must be present at the content tier", name, c.key)
				assert.Equal(t, c.want, got, name)
			}
		})

		t.Run("scrubs nothing operational — span names, hierarchy and pod identity survive", func(t *testing.T) {
			chat, ok := spanByName(out, "ai.streamText")
			require.True(t, ok, "the worker's own span name must survive")
			tool, ok := spanByName(out, "ai.toolCall")
			require.True(t, ok)
			assert.Equal(t, chat.SpanID(), tool.ParentSpanID(),
				"the worker's parent/child hierarchy must survive")
			pod, ok := str(mirrorResourceAttrs(out), "k8s.pod.name")
			require.True(t, ok, "worker infra identity is not scrubbed on the mirror")
			assert.Equal(t, "langy-worker-7", pod)
			toks, ok := chat.Attributes().Get("gen_ai.usage.input_tokens")
			require.True(t, ok)
			assert.EqualValues(t, 42, toks.Int())
		})

		t.Run("substitutes the manager-owned model for the worker-supplied one", func(t *testing.T) {
			chat, _ := spanByName(out, "ai.streamText")
			model, _ := str(chat.Attributes(), "gen_ai.request.model")
			assert.Equal(t, "openai/gpt-5-mini", model)
		})

		t.Run("marks worker model-call spans as redundant usage copies", func(t *testing.T) {
			// The gateway's mirror leg delivers its own gen_ai span per call, so
			// it is the meter in the mirror project too; the worker span's
			// usage must not double the mirrored turn's totals.
			chat, _ := spanByName(out, "ai.streamText")
			skip, ok := str(chat.Attributes(), "langwatch.reserved.skip_token_accumulation")
			require.True(t, ok, "model-call span must carry the dedup stamp")
			assert.Equal(t, "true", skip)
			tool, _ := spanByName(out, "ai.toolCall")
			_, stamped := tool.Attributes().Get("langwatch.reserved.skip_token_accumulation")
			assert.False(t, stamped, "tool spans carry no usage and must not be stamped")
		})
	})

	t.Run("when the tier is structural", func(t *testing.T) {
		out := MirrorCopy(mirrorWorkerBatch(t), MirrorParams{
			ConversationID: "conv-1", TrustedModel: "openai/gpt-5-mini",
			Turn: mirrorTurn(), IncludeContent: false,
		})

		t.Run("removes every content key", func(t *testing.T) {
			for name, c := range contentAttrs {
				span, ok := spanByName(out, c.span)
				require.True(t, ok, name)
				_, present := span.Attributes().Get(c.key)
				assert.False(t, present, "%s: %q must NOT travel at the structural tier", name, c.key)
			}
		})

		t.Run("keeps the operational shape — names, tokens, model", func(t *testing.T) {
			chat, ok := spanByName(out, "ai.streamText")
			require.True(t, ok, "structural still carries the worker's operational spans")
			toks, ok := chat.Attributes().Get("gen_ai.usage.input_tokens")
			require.True(t, ok, "token usage is operational, not content")
			assert.EqualValues(t, 42, toks.Int())
			model, _ := str(chat.Attributes(), "gen_ai.request.model")
			assert.Equal(t, "openai/gpt-5-mini", model)
		})
	})
}

// The tier boundary is defined by mirrorContentKeys (a closed content set), NOT
// by an operational allowlist: the structural tier removes exactly those keys.
// A newly-introduced attribute is therefore treated by its NAME, and this test
// pins that boundary in both directions so a future edit to the content set is a
// deliberate, visible act.
func TestMirrorCopy_NewlyIntroducedAttribute(t *testing.T) {
	t.Run("content tier carries a novel content attribute (scrub nothing)", func(t *testing.T) {
		out := MirrorCopy(mirrorWorkerBatch(t), MirrorParams{
			ConversationID: "c", Turn: mirrorTurn(), IncludeContent: true,
		})
		chat, _ := spanByName(out, "ai.streamText")
		got, ok := str(chat.Attributes(), novelContentKey)
		require.True(t, ok, "the content tier scrubs nothing")
		assert.Equal(t, novelContentVal, got)
	})

	t.Run("structural tier strips ONLY the enumerated content keys", func(t *testing.T) {
		out := MirrorCopy(mirrorWorkerBatch(t), MirrorParams{
			ConversationID: "c", Turn: mirrorTurn(), IncludeContent: false,
		})
		chat, _ := spanByName(out, "ai.streamText")
		// The enumerated content keys are gone...
		_, hasMessages := chat.Attributes().Get("gen_ai.input.messages")
		assert.False(t, hasMessages)
		// ...but an attribute NOT on mirrorContentKeys is NOT stripped: the
		// structural tier's content guarantee is exactly the enumerated set, so
		// covering a newly-introduced content attribute is the deliberate act of
		// adding it there (documented on mirrorContentKeys). This is the
		// scrub-nothing posture's known edge, surfaced by the ADR-061 PR's
		// ship-gate note.
		got, ok := str(chat.Attributes(), novelContentKey)
		require.True(t, ok)
		assert.Equal(t, novelContentVal, got)
	})
}

// The mirror never mutates the caller's batch — the customer forward reads the
// same pdata tree right after, and a shared mutation would corrupt it.
func TestMirrorCopy_DoesNotMutateSource(t *testing.T) {
	src := mirrorWorkerBatch(t)
	_ = MirrorCopy(src, MirrorParams{
		ConversationID: "c", TrustedModel: "m", Turn: mirrorTurn(),
		SourceOrgID: "o", SourceProjectID: "p", IncludeContent: false,
	})
	origin, _ := str(mirrorResourceAttrs(src), "langwatch.origin")
	assert.Equal(t, "platform_internal", origin, "source resource must be untouched")
	chat, _ := spanByName(src, "ai.streamText")
	msg, ok := str(chat.Attributes(), "gen_ai.input.messages")
	require.True(t, ok)
	assert.Equal(t, mirrorPrompt, msg, "source content must be untouched")
}
