package otelrelay

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
)

// The gateway mirrors by the Langy virtual key's tier, and a chat turn and a
// read-only run share that key. So the relay, which holds the turn's own tier,
// names a call whose turn mirrors nothing. The worker never decides it: what
// the worker sends in that header is replaced.
// @scenario "A read-only run's model calls never reach the mirror"
func TestLLMProxy_NamesAWithheldMirrorFromTheTurnsTier(t *testing.T) {
	cases := []struct {
		name   string
		tier   string
		worker string
		want   string
	}{
		{name: "a skip turn withholds the mirror", tier: "skip", want: "skip"},
		{name: "an empty tier reads as skip", tier: "", want: "skip"},
		{name: "a content turn leaves the mirror to the key", tier: "content", want: ""},
		{name: "a worker cannot withhold a content turn's mirror", tier: "content", worker: "skip", want: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got string
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				got = req.Header.Get(customertracebridge.HeaderLangyMirror)
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer gateway.Close()

			relay := startRelay(t)
			token, err := relay.Register(WorkerInfo{
				ConversationID: "conv-mirror",
				GatewayBaseURL: gateway.URL + "/v1",
				LLMVirtualKey:  "vk-real",
				MirrorTier:     tc.tier,
			})
			if err != nil {
				t.Fatalf("Register: %v", err)
			}

			req, _ := http.NewRequest(http.MethodPost,
				relay.LLMBaseURLFor(token)+"/chat/completions", strings.NewReader(`{}`))
			if tc.worker != "" {
				req.Header.Set(customertracebridge.HeaderLangyMirror, tc.worker)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("proxied call: %v", err)
			}
			resp.Body.Close()

			if got != tc.want {
				t.Fatalf("mirror header = %q, want %q", got, tc.want)
			}
		})
	}
}
