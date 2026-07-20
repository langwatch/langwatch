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

	"github.com/bytedance/sonic"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The Codex provider: the user's own ChatGPT subscription, reached through
// OpenAI's codex backend with an OAuth access token. Facts that shape this
// file (all verified against the codex CLI's behaviour):
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

// dispatchCodex handles the non-streaming path: the codex backend has none,
// so the caller gets a clean, actionable rejection instead of an upstream
// mystery.
func (r *BifrostRouter) dispatchCodex(
	ctx context.Context,
	req *domain.Request,
) (*domain.Response, error) {
	_ = req
	return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
		"reason": "codex models are stream-only; send the request with stream: true",
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
// OpenAI session cannot be refreshed. The body carries the typed code so
// Langy's error explainer renders the re-authenticate card.
func codexSessionExpiredError(ctx context.Context) error {
	_ = ctx
	body, _ := sonic.Marshal(map[string]any{
		"error": map[string]any{
			"type":    string(domain.ErrCodexSessionExpired),
			"code":    string(domain.ErrCodexSessionExpired),
			"message": "Your OpenAI session expired. Sign in to Codex again to keep using it.",
		},
	})
	return &domain.UpstreamError{
		StatusCode: http.StatusUnauthorized,
		Body:       body,
		Message:    "codex session expired; sign in again",
	}
}

// codexRequestBody pins the backend's invariants onto the caller's raw body:
// the bare model name (the gateway stays in control of what lands upstream),
// stream on, store off.
func codexRequestBody(raw []byte, model string) ([]byte, error) {
	body := raw
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte("{}")
	}
	bare := strings.TrimPrefix(model, codexModelPrefix)
	var err error
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
			return nil, fmt.Errorf("rewrite %s on codex body: %v", set.path, err)
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

// codexStreamIterator forwards the backend's SSE frames verbatim (one frame
// per Chunk, `rawFraming` semantics) while skimming usage off the
// `response.completed` event for the accounting pipeline — codex tokens cost
// $0 but still count against the user's plan, so the numbers stay honest.
type codexStreamIterator struct {
	body    io.ReadCloser
	reader  *bufio.Reader
	current []byte
	usage   domain.Usage
	err     error
	done    bool
}

func (it *codexStreamIterator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	select {
	case <-ctx.Done():
		it.err = ctx.Err()
		it.close()
		return false
	default:
	}

	var frame bytes.Buffer
	for {
		line, err := it.reader.ReadBytes('\n')
		frame.Write(line)
		if err != nil {
			// The final frame may end at EOF without a trailing blank line.
			if err != io.EOF {
				it.err = err
			}
			it.close()
			if frame.Len() > 0 {
				it.emit(frame.Bytes())
				return true
			}
			return false
		}
		// A blank line terminates one SSE frame.
		if len(bytes.TrimRight(line, "\r\n")) == 0 && frame.Len() > len(line) {
			it.emit(frame.Bytes())
			return true
		}
	}
}

func (it *codexStreamIterator) emit(frame []byte) {
	it.current = frame
	if usage, ok := parseCodexUsage(frame); ok {
		it.usage = usage
	}
}

func (it *codexStreamIterator) close() {
	if !it.done {
		it.done = true
		_ = it.body.Close()
	}
}

// Close releases the upstream body; safe to call at any point (the writer
// calls it when the client disconnects mid-stream).
func (it *codexStreamIterator) Close() error {
	it.close()
	return nil
}

func (it *codexStreamIterator) Chunk() []byte       { return it.current }
func (it *codexStreamIterator) Usage() domain.Usage { return it.usage }
func (it *codexStreamIterator) Err() error          { return it.err }

// RawFraming marks chunks as pre-framed SSE bytes for the HTTP writer, the
// same contract the passthrough iterators use.
func (it *codexStreamIterator) RawFraming() bool { return true }

// parseCodexUsage reads token usage from a `response.completed` frame's data
// payload. The codex backend reports usage the Responses-API way:
// `response.usage.{input_tokens,output_tokens}`.
func parseCodexUsage(frame []byte) (domain.Usage, bool) {
	for _, line := range bytes.Split(frame, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		payload := bytes.TrimSpace(line[len("data:"):])
		if len(payload) == 0 || bytes.Equal(payload, []byte("[DONE]")) {
			continue
		}
		eventType := gjson.GetBytes(payload, "type").String()
		if eventType != "response.completed" && eventType != "response.done" {
			continue
		}
		usage := gjson.GetBytes(payload, "response.usage")
		if !usage.Exists() {
			continue
		}
		in := int(usage.Get("input_tokens").Int())
		out := int(usage.Get("output_tokens").Int())
		return domain.Usage{
			PromptTokens:     in,
			CompletionTokens: out,
			TotalTokens:      in + out,
		}, true
	}
	return domain.Usage{}, false
}
