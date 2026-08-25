package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Spec: specs/model-providers/codex-account-provider.feature — the gateway
// leg: direct SSE proxy to the codex backend, 401 → refresh → retry once,
// dead sessions and plan limits surfaced as typed/verbatim upstream errors.

func codexTestRouter(backendURL string, refresher domain.CodexTokenRefresher) *BifrostRouter {
	return &BifrostRouter{
		codexClient:     newCodexClient(),
		codexRefresher:  refresher,
		codexBackendURL: backendURL,
	}
}

func codexRequest(body string) *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeResponses,
		Model: "openai_codex/gpt-5.6-terra",
		Body:  []byte(body),
	}
}

func codexCredential() domain.Credential {
	return domain.Credential{
		ID:         "cred-1",
		ProviderID: domain.ProviderOpenAICodex,
		APIKey:     "access-token-1",
		Extra: map[string]string{
			"account_id":      "acct-1",
			"provider_row_id": "row-1",
		},
	}
}

func collectFrames(t *testing.T, iter domain.StreamIterator) []string {
	t.Helper()
	var frames []string
	for iter.Next(context.Background()) {
		frames = append(frames, string(iter.Chunk()))
	}
	if err := iter.Err(); err != nil {
		t.Fatalf("stream errored: %v", err)
	}
	return frames
}

type refresherFunc func(ctx context.Context, rowID string) (string, string, error)

func (f refresherFunc) RefreshCodexToken(ctx context.Context, rowID string) (string, string, error) {
	return f(ctx, rowID)
}

// @scenario "A codex-lane response's cached prompt share is captured"
func TestCodexStream_ProxiesSSEAndParsesUsage(t *testing.T) {
	var gotBody map[string]any
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer access-token-1" {
			t.Errorf("missing bearer, got %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("ChatGPT-Account-ID") != "acct-1" {
			t.Errorf("missing account id header")
		}
		if r.Header.Get("originator") != "codex_cli_rs" {
			t.Errorf("missing originator header")
		}
		if r.Header.Get("OpenAI-Beta") != "responses=experimental" {
			t.Errorf("missing beta header")
		}
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w,
			"event: response.output_text.delta\n"+
				`data: {"type":"response.output_text.delta","delta":"hi"}`+"\n\n"+
				"event: response.completed\n"+
				`data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":5,"input_tokens_details":{"cached_tokens":8}}}}`+"\n\n")
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, nil)
	iter, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{"model":"whatever","input":[]}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	frames := collectFrames(t, iter)

	// The backend's invariants were pinned onto the raw body.
	if gotBody["model"] != "gpt-5.6-terra" {
		t.Errorf("model not rewritten bare, got %v", gotBody["model"])
	}
	if gotBody["stream"] != true || gotBody["store"] != false {
		t.Errorf("stream/store invariants not pinned: %v", gotBody)
	}

	// Frames forwarded verbatim, usage skimmed off response.completed.
	if len(frames) != 2 || !strings.Contains(frames[0], "response.output_text.delta") {
		t.Fatalf("frames not forwarded verbatim: %#v", frames)
	}
	usage := iter.Usage()
	if usage.PromptTokens != 12 || usage.CompletionTokens != 5 || usage.TotalTokens != 17 {
		t.Errorf("usage not parsed: %+v", usage)
	}
	// The Responses-style cached prefix count must survive: input_tokens is
	// the full prompt total, the cached share rides separately so the trace
	// can report fresh vs cached and the cost can price the cache read.
	if usage.CacheReadTokens != 8 {
		t.Errorf("cached tokens not parsed: %+v", usage)
	}
}

func TestCodexStream_RefreshesOnceOn401(t *testing.T) {
	var calls atomic.Int32
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"expired"}}`))
			return
		}
		if r.Header.Get("Authorization") != "Bearer fresh-token" {
			t.Errorf("retry did not carry the refreshed token")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `data: {"type":"response.completed","response":{}}`+"\n\n")
	}))
	defer backend.Close()

	refreshed := atomic.Int32{}
	router := codexTestRouter(backend.URL, refresherFunc(func(_ context.Context, rowID string) (string, string, error) {
		refreshed.Add(1)
		if rowID != "row-1" {
			t.Errorf("refresh addressed wrong row: %s", rowID)
		}
		return "fresh-token", "acct-1", nil
	}))

	iter, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	_ = collectFrames(t, iter)
	if refreshed.Load() != 1 {
		t.Errorf("expected exactly one refresh, got %d", refreshed.Load())
	}
	if calls.Load() != 2 {
		t.Errorf("expected exactly one retry, got %d calls", calls.Load())
	}
}

// A refresh grant can succeed while the fresh token is itself rejected (the
// account was revoked between grant and use). That retry-still-401 is a dead
// session and must surface the typed code, not the provider's raw 401.
func TestCodexStream_StillUnauthorizedAfterRefreshIsSessionExpired(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid token"}}`))
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, refresherFunc(func(context.Context, string) (string, string, error) {
		return "fresh-token", "acct-1", nil
	}))

	_, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	var herrErr herr.E
	if !errors.As(err, &herrErr) {
		t.Fatalf("expected herr.E, got %v", err)
	}
	if herrErr.Code != domain.ErrCodexSessionExpired {
		t.Errorf("retry-still-401 must carry the typed code, got: %s", herrErr.Code)
	}
}

func TestCodexStream_DeadSessionSurfacesTypedError(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, refresherFunc(func(context.Context, string) (string, string, error) {
		return "", "", fmt.Errorf("control plane: %w", domain.ErrCodexSessionDead)
	}))

	_, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	var herrErr herr.E
	if !errors.As(err, &herrErr) {
		t.Fatalf("expected herr.E, got %v", err)
	}
	if herrErr.Code != domain.ErrCodexSessionExpired {
		t.Errorf("body missing typed code: %s", herrErr.Code)
	}
}

func TestCodexStream_PlanLimitForwardedVerbatim(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"type":"usage_limit_reached","message":"You've hit your usage limit."}}`))
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, nil)
	_, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	var upstream *domain.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("expected UpstreamError, got %v", err)
	}
	if upstream.StatusCode != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", upstream.StatusCode)
	}
	if !strings.Contains(string(upstream.Body), "usage_limit_reached") {
		t.Errorf("provider body not forwarded verbatim: %s", upstream.Body)
	}
	if upstream.Headers["Retry-After"] != "3600" {
		t.Errorf("retry hint dropped: %v", upstream.Headers)
	}
}

func TestCodex_NonStreamingAggregatesTheSSE(t *testing.T) {
	// The backend is SSE-only and its response.completed carries an EMPTY
	// output array — the aggregate must stitch the output_item.done items in.
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w,
			`data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"hello"}]}}`+"\n\n"+
				`data: {"type":"response.completed","response":{"id":"resp-1","output":[],"usage":{"input_tokens":3,"output_tokens":2}}}`+"\n\n")
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, nil)
	resp, err := router.dispatchCodex(
		context.Background(),
		codexRequest(`{"input":[]}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	if err != nil {
		t.Fatalf("aggregate dispatch: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	body := string(resp.Body)
	if !strings.Contains(body, `"id":"resp-1"`) || !strings.Contains(body, "hello") {
		t.Errorf("output items not stitched into the completed response: %s", body)
	}
	if resp.Usage.TotalTokens != 5 {
		t.Errorf("usage not carried: %+v", resp.Usage)
	}
}

// @scenario "A codex request carries only what its backend accepts"
func TestCodexRequestBody_PinsInvariantsAndKeepsOnlyAcceptedFields(t *testing.T) {
	// A caller's body carrying every tuning field the live backend refuses,
	// plus the ones it accepts: rewrite the model to bare, force stream on /
	// store off, drop the refused fields, and leave the accepted ones
	// untouched.
	raw := []byte(`{"model":"openai_codex/gpt-5.6-terra","temperature":0.2,"top_p":0.9,` +
		`"prompt_cache_retention":"24h","prompt_cache_options":{"mode":"explicit"},` +
		`"max_output_tokens":16384,"truncation":"auto",` +
		`"metadata":{"a":"b"},"service_tier":"auto","user":"u",` +
		`"safety_identifier":"s",` +
		`"prompt_cache_key":"session-1","instructions":"be brief",` +
		`"tools":[{"type":"function","name":"t"}],"tool_choice":"auto",` +
		`"parallel_tool_calls":true,"reasoning":{"effort":"medium","summary":"auto"},` +
		`"text":{"verbosity":"medium"},"stream_options":{"include_obfuscation":false},` +
		`"input":[{"role":"user"}],"include":["reasoning.encrypted_content"]}`)
	body, dropped, err := codexRequestBody(raw, "openai_codex/gpt-5.6-terra")
	if err != nil {
		t.Fatalf("codexRequestBody: %v", err)
	}
	if got := gjson.GetBytes(body, "model").String(); got != "gpt-5.6-terra" {
		t.Errorf("model not rewritten to bare: %q", got)
	}
	if !gjson.GetBytes(body, "stream").Bool() {
		t.Error("stream must be forced on")
	}
	if gjson.GetBytes(body, "store").Bool() {
		t.Error("store must be forced off")
	}
	// Every one of these answers 400 "Unsupported parameter" from the live
	// backend, before a token is generated. max_output_tokens is the one pi
	// sends on every turn, from its own 16384 default.
	refusedUpstream := []string{
		"temperature", "top_p", "prompt_cache_retention", "prompt_cache_options",
		"max_output_tokens", "truncation", "metadata",
		"service_tier", "user", "safety_identifier",
	}
	for _, field := range refusedUpstream {
		if gjson.GetBytes(body, field).Exists() {
			t.Errorf("%s must be dropped (the codex backend 400s on it): %s", field, body)
		}
	}
	// The drop list feeds the response-side signals (params_dropped header
	// and span), sorted so the signal is stable.
	if got, want := strings.Join(dropped, ","), strings.Join(slices.Sorted(slices.Values(refusedUpstream)), ","); got != want {
		t.Errorf("dropped list must name every removed field, got %q want %q", got, want)
	}
	// What the backend accepts must survive: prompt_cache_key keeps the
	// session's cache routing, and the rest is the turn itself.
	if got := gjson.GetBytes(body, "prompt_cache_key").String(); got != "session-1" {
		t.Errorf("prompt_cache_key must pass through, got %q in %s", got, body)
	}
	for _, field := range []string{
		"instructions", "tools", "tool_choice", "parallel_tool_calls",
		"reasoning", "text", "stream_options", "input",
	} {
		if !gjson.GetBytes(body, field).Exists() {
			t.Errorf("%s must pass through: %s", field, body)
		}
	}
	if got := gjson.GetBytes(body, "reasoning.summary").String(); got != "auto" {
		t.Errorf("an accepted field must keep its value, got %q in %s", got, body)
	}
	if got := gjson.GetBytes(body, "include.0").String(); got != "reasoning.encrypted_content" {
		t.Errorf("client include must pass through: %s", body)
	}
}

// @scenario "A tuning option the codex backend refuses is dropped with a signal"
func TestCodexRequestBody_ReportsDropsForTheResponseSignals(t *testing.T) {
	raw := []byte(`{"model":"openai_codex/gpt-5.6-terra","input":[{"role":"user"}],` +
		`"max_output_tokens":16384,"temperature":0.2}`)
	_, dropped, err := codexRequestBody(raw, "openai_codex/gpt-5.6-terra")
	if err != nil {
		t.Fatalf("codexRequestBody: %v", err)
	}
	if got := strings.Join(dropped, ","); got != "max_output_tokens,temperature" {
		t.Fatalf("dropped list: got %q", got)
	}
	// The recording puts the list on the response-header seam (the dispatch
	// meta accumulator setMetaHeaders reads) so X-LangWatch-Params-Dropped
	// carries it, same as the chat lanes.
	ctx := pipeline.NewMetaContext(context.Background())
	recordParamsDropped(ctx, dropped)
	snapshot := pipeline.MetaFromContext(ctx).Snapshot()
	if got := strings.Join(snapshot.ParamsDropped, ","); got != "max_output_tokens,temperature" {
		t.Fatalf("meta accumulator: got %q", got)
	}
}

// @scenario "An option a codex answer would silently betray is refused by name"
func TestCodexRequestBody_RefusesFunctionalFieldsByName(t *testing.T) {
	// The gateway pins store false, so a previous_response_id chain cannot
	// continue; background promises an id to poll; top_logprobs promises data
	// in the answer; max_tool_calls is a cap the model would exceed. Dropping
	// any of them returns an answer that is not what was asked for.
	for _, field := range []string{
		"previous_response_id", "background", "top_logprobs", "max_tool_calls",
	} {
		t.Run(field, func(t *testing.T) {
			raw := []byte(fmt.Sprintf(
				`{"model":"openai_codex/gpt-5.6-terra","input":[{"role":"user"}],%q:1}`, field))
			_, _, err := codexRequestBody(raw, "openai_codex/gpt-5.6-terra")
			var refusal *paramRefusalError
			if !errors.As(err, &refusal) {
				t.Fatalf("a functional field must refuse the request, got err=%v", err)
			}
			if !strings.Contains(refusal.Error(), field) {
				t.Errorf("the refusal must name the field: %q", refusal.Error())
			}
		})
	}
}

// @scenario "Strict mode refuses codex tuning options instead of dropping them"
func TestCodexRequestBody_StrictModeRefusesTuningOptions(t *testing.T) {
	raw := []byte(`{"model":"openai_codex/gpt-5.6-terra","input":[{"role":"user"}],` +
		`"temperature":0.2,"drop_tuning_params":false}`)
	_, _, err := codexRequestBody(raw, "openai_codex/gpt-5.6-terra")
	var refusal *paramRefusalError
	if !errors.As(err, &refusal) {
		t.Fatalf("strict mode must refuse a droppable option, got err=%v", err)
	}
	if !strings.Contains(refusal.Error(), "temperature") || !strings.Contains(refusal.Error(), "drop_tuning_params") {
		t.Errorf("the refusal must name the option and the lever: %q", refusal.Error())
	}
	// The directive itself is the gateway's and never reaches the backend.
	body, _, err := codexRequestBody(
		[]byte(`{"model":"openai_codex/gpt-5.6-terra","input":[],"drop_tuning_params":true}`),
		"openai_codex/gpt-5.6-terra")
	if err != nil {
		t.Fatalf("codexRequestBody: %v", err)
	}
	if gjson.GetBytes(body, "drop_tuning_params").Exists() {
		t.Errorf("drop_tuning_params must be consumed, not forwarded: %s", body)
	}
}

func TestCodexRequestBody_DropsAKeyThatLooksLikeAPath(t *testing.T) {
	// A field name used to become an sjson path, and three classes of name
	// broke the call they rode on: "." "*" "?" and ":" select something else,
	// so ":input" dropped "input", the one field a turn cannot go out without;
	// "|" "#" and "@" make the path complex, which sjson refuses; and an empty
	// name has no path at all. All three failed or corrupted the request over
	// what the caller happened to call a field.
	refused := []string{"a.b", "c*d", "e?f", ":input", "g|h", "i#j", "k@l", "", "café"}
	raw := []byte(`{"model":"openai_codex/gpt-5.6-terra","a.b":1,"c*d":2,"e?f":3,` +
		`":input":4,"g|h":5,"i#j":6,"k@l":7,"":8,"café":9,` +
		`"reasoning":{"effort":"medium"},"input":[{"role":"user"}]}`)
	body, _, err := codexRequestBody(raw, "openai_codex/gpt-5.6-terra")
	if err != nil {
		t.Fatalf("codexRequestBody: %v", err)
	}
	// Read the result's own top-level names rather than looking each one up by
	// path: the names under test are exactly the ones a path cannot express.
	kept := map[string]bool{}
	gjson.ParseBytes(body).ForEach(func(key, _ gjson.Result) bool {
		kept[key.String()] = true
		return true
	})
	for _, key := range refused {
		if kept[key] {
			t.Errorf("the refused key %q must be dropped: %s", key, body)
		}
	}
	if got := gjson.GetBytes(body, "input.0.role").String(); got != "user" {
		t.Errorf("the turn's own input must survive, got %q in %s", got, body)
	}
	if got := gjson.GetBytes(body, "reasoning.effort").String(); got != "medium" {
		t.Errorf("an accepted nested field must survive, got %q in %s", got, body)
	}
}

func TestCodexRequestBody_EmptyBodyStillCarriesTheInvariants(t *testing.T) {
	body, _, err := codexRequestBody(nil, "openai_codex/gpt-5.6-terra")
	if err != nil {
		t.Fatalf("codexRequestBody: %v", err)
	}
	if got := gjson.GetBytes(body, "model").String(); got != "gpt-5.6-terra" {
		t.Errorf("model not pinned on an empty body: %s", body)
	}
	if !gjson.GetBytes(body, "stream").Bool() || gjson.GetBytes(body, "store").Bool() {
		t.Errorf("stream/store not pinned on an empty body: %s", body)
	}
}

func TestCodexRequestBody_RejectsABodyThatIsNotAnObject(t *testing.T) {
	// Only an object has fields to filter. Each of these read as no fields at
	// all and was rebuilt into the pins alone, so a well-formed request with
	// no turn in it went upstream and the caller paid a provider round trip
	// to be told what the gateway could already see.
	for _, raw := range []string{
		"null",
		"[]",
		`[{"input":"hi"}]`,
		`"a string"`,
		"123",
		`{"model":"m"} trailing`,
		`{"input":[{"role":"user"}]`,
		"not json at all",
	} {
		t.Run(raw, func(t *testing.T) {
			body, _, err := codexRequestBody([]byte(raw), "openai_codex/gpt-5.6-terra")
			if err == nil {
				t.Errorf("a body that is not an object must be refused, got %s", body)
			}
		})
	}
}

func TestCodex_WrongRequestTypeIsRejected(t *testing.T) {
	router := codexTestRouter("http://unused.test", nil)
	chatReq := codexRequest(`{}`)
	chatReq.Type = domain.RequestTypeChat
	if _, err := router.dispatchCodexStream(
		context.Background(), chatReq, "openai_codex/gpt-5.6-terra", codexCredential(),
	); err == nil {
		t.Fatal("non-responses codex stream must be rejected")
	}
}
