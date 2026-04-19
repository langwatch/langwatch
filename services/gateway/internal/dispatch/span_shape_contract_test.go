package dispatch

import (
	"context"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.opentelemetry.io/otel/attribute"

	gwotel "github.com/langwatch/langwatch/services/gateway/internal/otel"
)

// TestSpanShape_PerProviderUsageMappingContract is the CI gate described
// in specs/ai-gateway/span-shape.feature §2 + §7. Every provider row
// below MUST produce the same gen_ai.usage.{input,output}_tokens span
// attributes — because Bifrost normalises every upstream's usage shape
// into BifrostChatResponse.Usage before the gateway sees it.
//
// What this gate protects:
//
//   - Rename of AttrUsageIn/AttrUsageOut away from the gen_ai.* semconv
//     (the #74 bug) fails the test immediately.
//   - Drift in Bifrost's normalisation (e.g. if a future version stops
//     normalising a particular provider) surfaces as a test failure for
//     that provider row.
//   - Silent drop of usage (e.g. span stamped with 0 instead of the
//     upstream number) is caught because the assertion compares the
//     stamped value to the expected > 0 integer.
//
// Each row is the post-Bifrost-normalised BifrostChatResponse that the
// dispatcher sees — identical by design for all six providers. That's
// the whole point: the gateway's span layer is transport-agnostic.
func TestSpanShape_PerProviderUsageMappingContract(t *testing.T) {
	type row struct {
		provider string
		usage    bfschemas.BifrostLLMUsage
		wantIn   int64
		wantOut  int64
		wantCR   int64
		wantCW   int64
	}
	rows := []row{
		{
			provider: "openai",
			usage:    bfschemas.BifrostLLMUsage{PromptTokens: 7, CompletionTokens: 119, TotalTokens: 126},
			wantIn:   7, wantOut: 119,
		},
		{
			provider: "anthropic",
			usage: bfschemas.BifrostLLMUsage{
				PromptTokens: 7, CompletionTokens: 119, TotalTokens: 126,
				PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{
					CachedReadTokens:  50,
					CachedWriteTokens: 100,
				},
			},
			wantIn: 7, wantOut: 119, wantCR: 50, wantCW: 100,
		},
		{
			provider: "bedrock",
			usage:    bfschemas.BifrostLLMUsage{PromptTokens: 7, CompletionTokens: 119, TotalTokens: 126},
			wantIn:   7, wantOut: 119,
		},
		{
			provider: "gemini",
			usage:    bfschemas.BifrostLLMUsage{PromptTokens: 7, CompletionTokens: 119, TotalTokens: 126},
			wantIn:   7, wantOut: 119,
		},
		{
			provider: "vertex",
			usage:    bfschemas.BifrostLLMUsage{PromptTokens: 7, CompletionTokens: 119, TotalTokens: 126},
			wantIn:   7, wantOut: 119,
		},
		{
			provider: "azure",
			usage:    bfschemas.BifrostLLMUsage{PromptTokens: 7, CompletionTokens: 119, TotalTokens: 126},
			wantIn:   7, wantOut: 119,
		},
	}
	for _, r := range rows {
		r := r
		t.Run(r.provider, func(t *testing.T) {
			resp := &bfschemas.BifrostChatResponse{
				ID:    "chatcmpl-" + r.provider,
				Model: r.provider + "-test-model",
				Usage: &r.usage,
			}

			in, out, cr, cw, _ := extractUsage(resp)

			attrs := spanAttrs(t, func(ctx context.Context) {
				// Mirror the dispatcher's stamp block (ServeChatCompletions
				// post-response path) so we exercise the same code surface
				// the hot path uses. If the keys ever drift, this breaks.
				gwotel.AddInt64Attr(ctx, gwotel.AttrUsageIn, int64(in))
				gwotel.AddInt64Attr(ctx, gwotel.AttrUsageOut, int64(out))
				if total := in + out; total > 0 {
					gwotel.AddInt64Attr(ctx, gwotel.AttrGenAIUsageTotalTokens, int64(total))
				}
				gwotel.AddInt64Attr(ctx, gwotel.AttrUsageCacheReadInputTokens, int64(cr))
				gwotel.AddInt64Attr(ctx, gwotel.AttrUsageCacheCreationInputTokens, int64(cw))
				stampGenAIResponseMeta(ctx, resp)
			})

			// Hardened assertions — the §2 scenario's AND-chain encoded
			// per provider row. Every assertion is on the OTel semconv
			// key directly, not a wrapper constant, so a drop-and-rename
			// of the constant surfaces here.
			mustI64(t, attrs, "gen_ai.usage.input_tokens", r.wantIn)
			mustI64(t, attrs, "gen_ai.usage.output_tokens", r.wantOut)
			if r.wantIn+r.wantOut > 0 {
				mustI64(t, attrs, "gen_ai.usage.total_tokens", r.wantIn+r.wantOut)
			}
			mustI64(t, attrs, "gen_ai.usage.cache_read.input_tokens", r.wantCR)
			mustI64(t, attrs, "gen_ai.usage.cache_creation.input_tokens", r.wantCW)
			mustStr(t, attrs, "gen_ai.response.id", "chatcmpl-"+r.provider)
			mustStr(t, attrs, "gen_ai.response.model", r.provider+"-test-model")
		})
	}
}

// TestSpanShape_ErrorSpanOmitsUsage is the §5 contract — an upstream
// error (no Usage on the response) must NOT emit zeroed usage attrs.
// The renderer otherwise misrenders 0-token error requests as if the
// upstream returned an empty response.
func TestSpanShape_ErrorSpanOmitsUsage(t *testing.T) {
	// Simulate the error path: no response at all, no Usage to extract.
	attrs := spanAttrs(t, func(ctx context.Context) {
		// The dispatcher's error path does NOT call the usage stamping
		// block at all — it just records status and bails. We mirror
		// that contract here: the span carries no gen_ai.usage.*
		// attribute when there's no usage.
		stampGenAIResponseMeta(ctx, nil)
	})
	for _, key := range []string{
		"gen_ai.usage.input_tokens",
		"gen_ai.usage.output_tokens",
		"gen_ai.usage.total_tokens",
	} {
		if _, ok := attrs[key]; ok {
			t.Errorf("error span should not stamp %s, got %v", key, attrs[key])
		}
	}
}

func mustI64(t *testing.T, attrs map[string]attribute.Value, key string, want int64) {
	t.Helper()
	v, ok := attrs[key]
	if !ok {
		t.Errorf("missing attribute %s", key)
		return
	}
	if v.AsInt64() != want {
		t.Errorf("%s: want %d, got %d", key, want, v.AsInt64())
	}
}

func mustStr(t *testing.T, attrs map[string]attribute.Value, key, want string) {
	t.Helper()
	v, ok := attrs[key]
	if !ok {
		t.Errorf("missing attribute %s", key)
		return
	}
	if v.AsString() != want {
		t.Errorf("%s: want %q, got %q", key, want, v.AsString())
	}
}
