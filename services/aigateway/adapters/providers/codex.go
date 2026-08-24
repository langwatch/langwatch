package providers

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The Codex provider: the user's own ChatGPT subscription, reached through
// OpenAI's codex backend with an OAuth access token. Facts that shape this
// file (all verified against the codex CLI's behavior):
//
//   - The backend speaks the RESPONSES API only, over SSE only, and is
//     stateless: `store` must be false, `stream` must be true, and clients
//     round-trip reasoning via encrypted content. Callers here (opencode /
//     the Langy agent) already speak exactly that dialect, so the body is
//     forwarded raw; the gateway only pins the invariants and rewrites the
//     model id to the bare name.
//   - Auth is `Authorization: Bearer <access token>` plus the ChatGPT
//     account id header; `originator` + `OpenAI-Beta` mark the codex wire
//     dialect.
//   - A 401 means the access token aged out. The control plane owns the
//     stored session, so the gateway asks it to refresh (once) and retries;
//     a refresh rejection is terminal (`codex_session_expired`) and the
//     user must sign in again.
//   - Plan limits surface as the provider's own 429 / refusal body, which
//     is forwarded verbatim so Langy can explain it and suggest another
//     model.
//
// Spec: specs/model-providers/codex-account-provider.feature
const codexBackendDefaultURL = "https://chatgpt.com/backend-api/codex/responses"

const codexModelPrefix = "openai_codex/"

// newCodexClient builds the streaming HTTP client. No overall Timeout — a
// codex turn can stream for minutes; cancellation rides the request context.
func newCodexClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			MaxIdleConnsPerHost: 20,
			IdleConnTimeout:     90 * time.Second,
			ForceAttemptHTTP2:   true,
		},
	}
}

// dispatchCodex handles non-streaming Responses requests. The codex backend
// itself is SSE-only, so the gateway streams upstream and aggregates to the
// completed Response object here — what lets non-streaming clients (the tiny
// AI assists via the Vercel AI SDK's responses provider) use codex without
// speaking SSE. One quirk, verified live by the reference implementation:
// this backend's `response.completed` event carries an EMPTY output array,
// so output items are collected from `response.output_item.done` events and
// stitched back in.
func (r *BifrostRouter) dispatchCodex(
	ctx context.Context,
	req *domain.Request,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	iter, err := r.dispatchCodexStream(ctx, req, model, cred)
	if err != nil {
		var upstream *domain.UpstreamError
		if errors.As(err, &upstream) {
			// Non-streaming callers get the provider's error as a plain HTTP
			// response, same as every other provider's non-stream path.
			return &domain.Response{
				Body:       upstream.Body,
				StatusCode: upstream.StatusCode,
				Headers:    upstream.Headers,
			}, nil
		}
		return nil, err
	}
	defer func() { _ = iter.Close() }()

	// Output items accumulate straight into JSON-array bytes ("[a,b,…") so the
	// stitch at the end is a single raw set — no intermediate slice to
	// re-marshal.
	var stitched bytes.Buffer
	for iter.Next(ctx) {
		payload, ok := codexFrameData(iter.Chunk())
		if !ok {
			continue
		}
		switch gjson.GetBytes(payload, "type").String() {
		case "response.output_item.done":
			if item := gjson.GetBytes(payload, "item"); item.Exists() {
				if stitched.Len() == 0 {
					stitched.WriteByte('[')
				} else {
					stitched.WriteByte(',')
				}
				stitched.WriteString(item.Raw)
			}
		case "response.completed", "response.done":
			response := []byte(gjson.GetBytes(payload, "response").Raw)
			if len(response) == 0 {
				continue
			}
			if !gjson.GetBytes(response, "output.0").Exists() && stitched.Len() > 0 {
				stitched.WriteByte(']')
				response, _ = sjson.SetRawBytes(response, "output", stitched.Bytes())
			}
			return &domain.Response{
				Body:       response,
				StatusCode: http.StatusOK,
				Usage:      iter.Usage(),
			}, nil
		case "response.failed", "error":
			message := gjson.GetBytes(payload, "response.error.message").String()
			if message == "" {
				message = gjson.GetBytes(payload, "error.message").String()
			}
			if message == "" {
				message = "codex response failed"
			}
			return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": message})
		}
	}
	if err := iter.Err(); err != nil {
		return nil, fmt.Errorf("codex aggregate: %w", err)
	}
	return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
		"reason": "codex stream ended without response.completed",
	})
}

// dispatchCodexStream proxies a streaming Responses-API request to the codex
// backend, with the one-shot 401 → refresh → retry recovery.
func (r *BifrostRouter) dispatchCodexStream(
	ctx context.Context,
	req *domain.Request,
	model string,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	if req.Type != domain.RequestTypeResponses {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"reason": fmt.Sprintf(
				"codex models serve the Responses API only (/v1/responses); got %s",
				req.Type,
			),
		})
	}

	body, err := codexRequestBody(req.Body, model)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": err.Error()})
	}

	accessToken := cred.APIKey
	accountID := cred.Extra["account_id"]

	resp, err := r.doCodexRequest(ctx, body, accessToken, accountID)
	if err != nil {
		return nil, fmt.Errorf("codex dispatch: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized {
		// The access token aged out mid-session. Ask the control plane (the
		// session's owner) for a refreshed one and retry exactly once.
		_ = resp.Body.Close()
		refreshed, refreshErr := r.refreshCodexCredential(ctx, cred)
		if refreshErr != nil {
			return nil, refreshErr
		}
		resp, err = r.doCodexRequest(ctx, body, refreshed.token, refreshed.accountID)
		if err != nil {
			return nil, fmt.Errorf("codex dispatch (post-refresh): %w", err)
		}
		if resp.StatusCode == http.StatusUnauthorized {
			// Still 401 on the freshly refreshed token: the session is
			// functionally dead even though the refresh grant succeeded.
			// Surface the typed session-expired error so Langy renders the
			// re-authenticate card instead of forwarding the raw 401.
			_ = resp.Body.Close()
			return nil, codexSessionExpiredError(ctx)
		}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		headers := map[string]string{}
		for _, name := range []string{"Retry-After", "x-should-retry"} {
			if v := resp.Header.Get(name); v != "" {
				headers[name] = v
			}
		}
		return nil, &domain.UpstreamError{
			StatusCode: resp.StatusCode,
			Body:       raw,
			Message:    fmt.Sprintf("codex backend HTTP %d", resp.StatusCode),
			Headers:    forwardableUpstreamHeaders(headers),
		}
	}

	return &codexStreamIterator{body: resp.Body, reader: bufio.NewReader(resp.Body)}, nil
}

type codexRefreshedCredential struct {
	token     string
	accountID string
}

func (r *BifrostRouter) refreshCodexCredential(
	ctx context.Context,
	cred domain.Credential,
) (codexRefreshedCredential, error) {
	rowID := cred.Extra["provider_row_id"]
	if r.codexRefresher == nil || rowID == "" {
		// No refresh road: surface the 401 as a dead session so the user is
		// sent to re-authenticate rather than left with a silent retry loop.
		return codexRefreshedCredential{}, codexSessionExpiredError(ctx)
	}
	token, accountID, err := r.codexRefresher.RefreshCodexToken(ctx, rowID)
	if err != nil {
		if errors.Is(err, domain.ErrCodexSessionDead) {
			return codexRefreshedCredential{}, codexSessionExpiredError(ctx)
		}
		return codexRefreshedCredential{}, fmt.Errorf("codex token refresh: %w", err)
	}
	return codexRefreshedCredential{token: token, accountID: accountID}, nil
}

// codexSessionExpiredError is the terminal 401 clients see when the stored
// OpenAI session cannot be refreshed. This is a LangWatch-authored error, not
// a forwarded provider response, so it goes through herr rather than
// domain.UpstreamError: that gets it the X-LangWatch-Handled-Error marker
// (writeUpstreamError never sets it) and Langy's error explainer trusts the
// marker before rendering the re-authenticate card.
func codexSessionExpiredError(ctx context.Context) error {
	return herr.New(ctx, domain.ErrCodexSessionExpired, herr.M{
		"message": "Your OpenAI session expired. Sign in to Codex again to keep using it.",
	})
}

// codexAllowedFields is what the ChatGPT codex backend accepts on a Responses
// body. Everything else comes back 400 "Unsupported parameter: <name>" before
// a single token is generated, so the gateway keeps the caller's body to this
// set instead of removing offenders one at a time.
//
// It is an allowlist because the backend keeps one of its own. A strip list
// costs a production outage per field, and it took two of them to learn that:
// pi sends prompt_cache_retention AND max_output_tokens, so stripping the
// first only uncovered the second. Verified against the live backend, which
// refuses at least max_output_tokens, max_tool_calls, prompt_cache_options,
// prompt_cache_retention, temperature, top_p, top_logprobs, truncation,
// metadata, service_tier, background, user, safety_identifier and
// previous_response_id, and accepts every field below.
//
// A field OpenAI adds later is dropped until it is listed here, and that is
// the safe direction: the same field on an unlisted body would have failed
// the whole request anyway.
var codexAllowedFields = map[string]bool{
	"model":               true,
	"input":               true,
	"instructions":        true,
	"stream":              true,
	"stream_options":      true,
	"store":               true,
	"include":             true,
	"tools":               true,
	"tool_choice":         true,
	"parallel_tool_calls": true,
	"reasoning":           true,
	"text":                true,
	"prompt_cache_key":    true,
}

// codexRequestBody pins the backend's invariants onto the caller's raw body:
// the bare model name (the gateway stays in control of what lands upstream),
// stream on, store off, and nothing the backend does not accept.
func codexRequestBody(raw []byte, model string) ([]byte, error) {
	body := raw
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte("{}")
	}
	// A Responses call is a JSON object, and only an object has fields to
	// filter. Without this, anything else read as no fields at all and was
	// rebuilt into the pins alone: a truncated body, an array, or plain text
	// went upstream as a well-formed request with no turn in it, and the
	// caller paid a provider round trip to be told what we could see here.
	if !gjson.ValidBytes(body) {
		return nil, errors.New("codex body is not valid JSON")
	}
	if !gjson.ParseBytes(body).IsObject() {
		return nil, errors.New("codex body must be a JSON object")
	}
	// The outgoing body is BUILT from the accepted names, rather than the
	// caller's body having the refused ones deleted out of it. A field name is
	// data, and turning data into an sjson path is what let a name break the
	// very call this filtering exists to save: ".", "*", "?" and ":" select
	// something else, so ":input" deleted "input"; "|", "#" and "@" make the
	// path complex, which DeleteBytes refuses; and an empty name has no path
	// at all. Copying under our own fixed names cannot address anything but
	// the field we mean, whatever the caller called theirs.
	out := []byte("{}")
	var err error
	gjson.ParseBytes(body).ForEach(func(key, value gjson.Result) bool {
		name := key.String()
		if !codexAllowedFields[name] {
			return true
		}
		out, err = sjson.SetRawBytes(out, name, []byte(value.Raw))
		return err == nil
	})
	if err != nil {
		return nil, fmt.Errorf("build codex body: %w", err)
	}
	body = out
	bare := strings.TrimPrefix(model, codexModelPrefix)
	for _, set := range []struct {
		path  string
		value any
	}{
		{"model", bare},
		{"stream", true},
		{"store", false},
	} {
		body, err = sjson.SetBytes(body, set.path, set.value)
		if err != nil {
			return nil, fmt.Errorf("rewrite %s on codex body: %w", set.path, err)
		}
	}
	return body, nil
}

func (r *BifrostRouter) doCodexRequest(
	ctx context.Context,
	body []byte,
	accessToken string,
	accountID string,
) (*http.Response, error) {
	httpReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		r.codexBackendURL,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+accessToken)
	if accountID != "" {
		httpReq.Header.Set("ChatGPT-Account-ID", accountID)
	}
	httpReq.Header.Set("originator", "codex_cli_rs")
	httpReq.Header.Set("OpenAI-Beta", "responses=experimental")
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	return r.codexClient.Do(httpReq)
}
