package otlpreceiver

import (
	"context"
	"testing"

	"go.uber.org/zap"
)

func nopLogger() *zap.Logger { return zap.NewNop() }

func TestNormalizeUpstreamBase(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		want     string
	}{
		{
			name:     "an /api/otel base is used as-is",
			endpoint: "https://app.langwatch.ai/api/otel",
			want:     "https://app.langwatch.ai/api/otel",
		},
		{
			name:     "a trailing slash is trimmed",
			endpoint: "https://app.langwatch.ai/api/otel/",
			want:     "https://app.langwatch.ai/api/otel",
		},
		{
			name:     "a fully-qualified traces url is normalised back to the base",
			endpoint: "https://app.langwatch.ai/api/otel/v1/traces",
			want:     "https://app.langwatch.ai/api/otel",
		},
		{
			name:     "a logs url is normalised back to the base too",
			endpoint: "https://app.langwatch.ai/api/otel/v1/logs",
			want:     "https://app.langwatch.ai/api/otel",
		},
		{
			name:     "a scheme-less endpoint defaults to https",
			endpoint: "app.langwatch.ai/api/otel",
			want:     "https://app.langwatch.ai/api/otel",
		},
		{
			name:     "http is preserved for local dev",
			endpoint: "http://localhost:5560/api/otel",
			want:     "http://localhost:5560/api/otel",
		},
		{
			name:     "whitespace is trimmed",
			endpoint: "  https://app.langwatch.ai/api/otel  ",
			want:     "https://app.langwatch.ai/api/otel",
		},
		{
			name:     "empty disables forwarding",
			endpoint: "",
			want:     "",
		},
		{
			name:     "an unparseable endpoint disables forwarding rather than failing the boot",
			endpoint: "://nonsense",
			want:     "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeUpstreamBase(tc.endpoint); got != tc.want {
				t.Errorf("normalizeUpstreamBase(%q) = %q, want %q", tc.endpoint, got, tc.want)
			}
		})
	}
}

// TestForwarderWithoutUpstreamIsInert: no endpoint means no workers and no
// queue growth — Enqueue is a no-op, not a leak.
func TestForwarderWithoutUpstreamIsInert(t *testing.T) {
	f := newForwarder(forwarderOptions{Logger: nopLogger()})

	for range 100 {
		f.Enqueue(payload{signal: signalTraces, body: []byte("x")})
	}
	if dropped := f.Dropped(); dropped != 0 {
		t.Errorf("dropped = %d, want 0 — a disabled forwarder drops nothing because it accepts nothing", dropped)
	}
	if err := f.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
}

func TestForwarderEnqueueAfterShutdownIsSafe(t *testing.T) {
	f := newForwarder(forwarderOptions{Endpoint: "http://127.0.0.1:1/api/otel", Logger: nopLogger()})

	if err := f.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	// Must not panic on a closed channel — a late worker export can race the
	// lifecycle group's shutdown.
	f.Enqueue(payload{signal: signalTraces, body: []byte("x")})
}

func TestHexIDToBase64(t *testing.T) {
	tests := []struct {
		name   string
		id     string
		want   string
		wantOK bool
	}{
		{
			name:   "a 32-char hex trace id converts",
			id:     "5b8efff798038103d269b633813fc60c",
			want:   "W47/95gDgQPSabYzgT/GDA==",
			wantOK: true,
		},
		{
			name:   "a 16-char hex span id converts",
			id:     "eee19b7ec3c1b174",
			want:   "7uGbfsPBsXQ=",
			wantOK: true,
		},
		{
			name:   "a base64 trace id is left alone (wrong length for hex)",
			id:     "W47/95gDgQPSabYzgT/GDA==",
			wantOK: false,
		},
		{
			name:   "a non-hex string of the right length is left alone",
			id:     "zzzzzzzzzzzzzzzz",
			wantOK: false,
		},
		{
			name:   "empty is left alone",
			id:     "",
			wantOK: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := hexIDToBase64(tc.id)
			if ok != tc.wantOK {
				t.Fatalf("hexIDToBase64(%q) ok = %v, want %v", tc.id, ok, tc.wantOK)
			}
			if ok && got != tc.want {
				t.Errorf("hexIDToBase64(%q) = %q, want %q", tc.id, got, tc.want)
			}
		})
	}
}

func TestResourceAttributes(t *testing.T) {
	tests := []struct {
		name           string
		conversationID string
		turnID         string
		want           string
	}{
		{
			name:           "conversation only is the spawn-time case",
			conversationID: "conv-1",
			want:           "langy.conversation_id=conv-1",
		},
		{
			name:           "a turn id is appended when a producer has one",
			conversationID: "conv-1",
			turnID:         "turn-9",
			want:           "langy.conversation_id=conv-1,langy.turn_id=turn-9",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ResourceAttributes(tc.conversationID, tc.turnID); got != tc.want {
				t.Errorf("ResourceAttributes(%q, %q) = %q, want %q",
					tc.conversationID, tc.turnID, got, tc.want)
			}
		})
	}
}
