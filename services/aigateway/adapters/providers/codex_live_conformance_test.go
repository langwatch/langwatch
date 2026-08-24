package providers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// The codex backend's allowlist is OpenAI's and can move. This probe checks
// every row of codexParamPolicyTable against the real backend: a mapped field
// must be accepted, a dropped or refused field must be rejected upstream. It
// is the check that would have caught both production outages before they
// shipped (prompt_cache_retention, then max_output_tokens), so run it before
// changing the codex lane.
//
// It needs a real ChatGPT sign-in, so it never runs in CI:
//
//	CODEX_LIVE_AUTH=$HOME/.codex/auth.json go test ./services/aigateway/adapters/providers -run TestCodexLiveConformance -v
//
// Spec: specs/model-providers/codex-account-provider.feature
// ("The codex disposition table agrees with the live backend", @live).

// codexLiveProbeValues carries one plausible value per table row. A row
// without a value fails the test, so a field added to the table must state
// how to probe it.
var codexLiveProbeValues = map[string]string{
	// Mapped rows. model, stream, store and input ride the base request.
	"model":               `"base"`,
	"input":               `"base"`,
	"stream":              `"base"`,
	"store":               `"base"`,
	"instructions":        `"Reply with the word ok and nothing else."`,
	"stream_options":      `{"include_obfuscation":false}`,
	"include":             `["reasoning.encrypted_content"]`,
	"tools":               `[]`,
	"tool_choice":         `"auto"`,
	"parallel_tool_calls": `true`,
	"reasoning":           `{"effort":"low"}`,
	"text":                `{"verbosity":"medium"}`,
	"prompt_cache_key":    `"langwatch-conformance-probe"`,
	// Refused rows.
	"previous_response_id": `"resp_00000000000000000000000000000000"`,
	"background":           `true`,
	"top_logprobs":         `2`,
	"max_tool_calls":       `2`,
	// Dropped rows.
	"max_output_tokens":      `128`,
	"temperature":            `1`,
	"top_p":                  `1`,
	"truncation":             `"auto"`,
	"metadata":               `{"probe":"conformance"}`,
	"service_tier":           `"auto"`,
	"user":                   `"langwatch-conformance-probe"`,
	"safety_identifier":      `"langwatch-conformance-probe"`,
	"prompt_cache_options":   `{}`,
	"prompt_cache_retention": `"24h"`,
}

func TestCodexLiveConformance(t *testing.T) {
	authPath := os.Getenv("CODEX_LIVE_AUTH")
	if authPath == "" {
		t.Skip("set CODEX_LIVE_AUTH=$HOME/.codex/auth.json to probe the live codex backend")
	}
	raw, err := os.ReadFile(authPath) //nolint:gosec // G703: the path is the operator's own env var, in a test the operator opts into
	if err != nil {
		t.Fatalf("read codex auth: %v", err)
	}
	var auth struct {
		Tokens struct {
			AccessToken string `json:"access_token"`
			AccountID   string `json:"account_id"`
		} `json:"tokens"`
	}
	if err := json.Unmarshal(raw, &auth); err != nil {
		t.Fatalf("parse codex auth: %v", err)
	}
	if auth.Tokens.AccessToken == "" {
		t.Fatal("codex auth carries no access token; sign in with the codex CLI first")
	}
	model := os.Getenv("CODEX_LIVE_MODEL")
	if model == "" {
		model = "gpt-5.6-luna"
	}

	client := &http.Client{Timeout: 60 * time.Second}
	base := fmt.Sprintf(`{"model":%q,"stream":true,"store":false,`+
		`"input":[{"role":"user","content":[{"type":"input_text","text":"Reply with the word ok and nothing else."}]}]}`, model)

	probe := func(t *testing.T, body []byte) (int, string) {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, codexBackendDefaultURL, bytes.NewReader(body))
		if err != nil {
			t.Fatalf("build probe request: %v", err)
		}
		req.Header.Set("Authorization", "Bearer "+auth.Tokens.AccessToken)
		if auth.Tokens.AccountID != "" {
			req.Header.Set("ChatGPT-Account-ID", auth.Tokens.AccountID)
		}
		req.Header.Set("originator", "codex_cli_rs")
		req.Header.Set("OpenAI-Beta", "responses=experimental")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		resp, err := client.Do(req) //nolint:gosec // G704: the URL is codexBackendDefaultURL, a package constant
		if err != nil {
			t.Fatalf("probe request: %v", err)
		}
		defer resp.Body.Close()
		detail := ""
		if resp.StatusCode != http.StatusOK {
			answer, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			detail = gjson.GetBytes(answer, "detail").String()
			if detail == "" {
				detail = string(answer)
			}
		}
		return resp.StatusCode, detail
	}

	// The base request must work at all before per-field verdicts mean
	// anything; an expired sign-in must not read as 28 refused fields.
	if status, detail := probe(t, []byte(base)); status != http.StatusOK {
		t.Fatalf("the base request itself failed (%d %s); refresh the codex sign-in and retry", status, detail)
	}

	for name, rule := range codexParamPolicyTable {
		value, ok := codexLiveProbeValues[name]
		if !ok {
			t.Errorf("%s: table row has no live probe value; add one to codexLiveProbeValues", name)
			continue
		}
		if value == `"base"` {
			continue
		}
		t.Run(name, func(t *testing.T) {
			body, err := sjson.SetRawBytes([]byte(base), name, []byte(value))
			if err != nil {
				t.Fatalf("build probe body: %v", err)
			}
			status, detail := probe(t, body)
			accepted := status == http.StatusOK
			wantAccepted := rule.disp == dispMapped
			if accepted != wantAccepted {
				t.Errorf("table says %s, backend says %d %s",
					dispositionLabel(rule), status, detail)
			}
		})
	}

	// The exact shape that caused both production outages: pi's worker sends
	// max_output_tokens (its own 16384 default) and prompt_cache_retention on
	// every Responses turn. The body the gateway actually builds from it must
	// be accepted by the real backend.
	t.Run("a pi-shaped body built by codexRequestBody is accepted", func(t *testing.T) {
		piBody := fmt.Sprintf(`{"model":%q,`+
			`"instructions":"Reply with the word ok and nothing else.",`+
			`"input":[{"role":"user","content":[{"type":"input_text","text":"hi"}]}],`+
			`"max_output_tokens":16384,"prompt_cache_retention":"long","temperature":1,`+
			`"stream":true,"store":true,"stream_options":{"include_obfuscation":false},`+
			`"include":["reasoning.encrypted_content"],"reasoning":{"effort":"low"}}`, model)
		body, dropped, err := codexRequestBody([]byte(piBody), codexModelPrefix+model)
		if err != nil {
			t.Fatalf("codexRequestBody: %v", err)
		}
		if len(dropped) != 3 {
			t.Errorf("expected max_output_tokens, prompt_cache_retention and temperature dropped, got %v", dropped)
		}
		status, detail := probe(t, body)
		if status != http.StatusOK {
			t.Errorf("the built body must be accepted, got %d %s", status, detail)
		}
	})

	// The default rule claims an unknown field would fail the whole request
	// upstream, which is what makes drop-by-default the safe direction.
	t.Run("an unknown field is rejected upstream", func(t *testing.T) {
		body, err := sjson.SetRawBytes([]byte(base), "langwatch_probe_unknown_field", []byte(`1`))
		if err != nil {
			t.Fatalf("build probe body: %v", err)
		}
		status, detail := probe(t, body)
		if status == http.StatusOK {
			t.Error("an unknown field was accepted; the backend may have stopped enforcing its allowlist")
		} else {
			t.Logf("rejected as expected: %d %s", status, detail)
		}
	})
}
