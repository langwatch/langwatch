package langytracebridge

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/attribute"
)

func TestFilterAttrsStripsContentKeepsShape(t *testing.T) {
	t.Parallel()
	in := []attribute.KeyValue{
		attribute.String("gen_ai.input.messages", "secret user prompt"),
		attribute.String("gen_ai.output.messages", "secret assistant answer"),
		attribute.String("gen_ai.request.model", "gpt-5-mini"),
		attribute.Int("gen_ai.usage.input_tokens", 42),
		attribute.String("langy.conversation.id", "conv_123"),
	}
	out := filterAttrs(in)

	got := map[string]bool{}
	for _, kv := range out {
		got[string(kv.Key)] = true
	}
	if got["gen_ai.input.messages"] || got["gen_ai.output.messages"] {
		t.Fatal("message content leaked into the internal tee")
	}
	for _, want := range []string{
		"gen_ai.request.model",
		"gen_ai.usage.input_tokens",
		"langy.conversation.id",
	} {
		if !got[want] {
			t.Fatalf("behavioural attribute %q was dropped", want)
		}
	}
}

func TestInstallNoEndpointIsNoop(t *testing.T) {
	t.Parallel()
	shutdown, err := Install(context.Background(), "", "")
	if err != nil {
		t.Fatalf("Install with no endpoint should not error: %v", err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("no-op shutdown should not error: %v", err)
	}
}

func TestParseHeaders(t *testing.T) {
	t.Parallel()
	h := parseHeaders("authorization=Bearer abc, x-scope = internal ")
	if h["authorization"] != "Bearer abc" {
		t.Fatalf("authorization header = %q", h["authorization"])
	}
	if h["x-scope"] != "internal" {
		t.Fatalf("x-scope header = %q", h["x-scope"])
	}
}

func TestNormalizeEndpoint(t *testing.T) {
	t.Parallel()
	cases := map[string]struct {
		host     string
		insecure bool
	}{
		"https://collector.langwatch.ai/v1/traces": {"collector.langwatch.ai", false},
		"http://localhost:4318":                    {"localhost:4318", true},
		"collector:4318":                           {"collector:4318", false},
	}
	for in, want := range cases {
		host, insecure := normalizeEndpoint(in)
		if host != want.host || insecure != want.insecure {
			t.Fatalf("normalizeEndpoint(%q) = (%q,%v), want (%q,%v)",
				in, host, insecure, want.host, want.insecure)
		}
	}
}
