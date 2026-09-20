package providers

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The LangWatch provider: another LangWatch gateway, reached as an upstream.
// A connected self-hosted install routes `langwatch/<model>` here and the call
// is served by LangWatch-managed models, metered on the LangWatch side against
// the license's own budget (ADR-139 section 8).
//
// Facts that shape this file:
//
//   - Both sides speak the OpenAI-compatible wire, so there is no translation
//     to do. The body is forwarded as it arrived with the model rewritten to
//     its bare name, and the answer is returned as it came.
//   - The credential is the license token plus the instance id. A license is
//     bound to one install, so the instance id rides its own header and the
//     far side refuses the token presented from anywhere else.
//   - Statuses are relayed verbatim. A 402 from the hosted budget reaches the
//     install's caller as a 402, and a `connect_service_not_entitled` reaches
//     it with its code and the handled-error marker, so one piece of copy
//     covers both sides.
//   - The token is a bearer credential that never belongs in a log line or a
//     span. This lane logs the model, the status and the duration and nothing
//     else.
//
// Spec: specs/self-hosting/connected-services/managed-models-provider.feature
const langWatchModelPrefix = "langwatch/"

// langWatchInstanceHeader carries the id of the install presenting the
// license, the same header the registry's credential resolution reads.
const langWatchInstanceHeader = "X-LangWatch-Instance"

// langWatchLoopbackHosts are the hosts a plain HTTP endpoint is allowed on: a
// developer running both gateways on their own machine. Anywhere else the
// license token would travel unencrypted, which is what the https rule stops.
var langWatchLoopbackHosts = map[string]struct{}{
	"localhost": {},
	"127.0.0.1": {},
	"::1":       {},
}

// langWatchPaths maps an inbound request type onto the path that serves it on
// the far gateway. A type with no entry has no route here and is refused
// before a round trip is paid for it.
var langWatchPaths = map[domain.RequestType]string{
	domain.RequestTypeChat:       "/chat/completions",
	domain.RequestTypeEmbeddings: "/embeddings",
	domain.RequestTypeResponses:  "/responses",
	domain.RequestTypeMessages:   "/messages",
}

// langWatchDispatch is one call to the LangWatch gateway: the request as it
// arrived, the model the resolver settled on, and the license credential.
type langWatchDispatch struct {
	req   *domain.Request
	model string
	cred  domain.Credential
}

// langWatchCall is one outbound HTTP request, after the endpoint and the body
// have been decided.
type langWatchCall struct {
	endpoint string
	body     []byte
	cred     domain.Credential
	accept   string
}

// newLangWatchClient builds the LangWatch-to-LangWatch HTTP client. No overall
// Timeout, because a streamed completion can run for minutes; cancellation
// rides the request context.
func newLangWatchClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			MaxIdleConnsPerHost: 20,
			IdleConnTimeout:     90 * time.Second,
			ForceAttemptHTTP2:   true,
		},
	}
}

// dispatchLangWatch forwards a non-streaming call and returns the far
// gateway's answer as it came: same status, same body, same forwardable
// headers. Usage is skimmed off the body for the install's own accounting.
func (r *BifrostRouter) dispatchLangWatch(
	ctx context.Context,
	call langWatchDispatch,
) (*domain.Response, error) {
	prepared, err := r.prepareLangWatchCall(ctx, call, "application/json")
	if err != nil {
		return nil, err
	}

	started := time.Now()
	resp, err := r.langWatchClient.Do(prepared.request)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderConnectionFailed, herr.M{
			"reason": fmt.Sprintf("langwatch dispatch: %v", err),
		})
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": fmt.Sprintf("langwatch read body: %v", err),
		})
	}
	r.logLangWatchCall(prepared.bareModel, resp.StatusCode, time.Since(started))

	return &domain.Response{
		Body:       raw,
		StatusCode: resp.StatusCode,
		Headers:    langWatchForwardHeaders(resp.Header),
		Usage:      langWatchUsage(raw, resp.StatusCode),
	}, nil
}

// dispatchLangWatchStream forwards a streamed call and hands back an iterator
// over the far gateway's SSE frames, so a chunk reaches the install's caller
// as it arrives rather than after the whole answer has been collected.
func (r *BifrostRouter) dispatchLangWatchStream(
	ctx context.Context,
	call langWatchDispatch,
) (domain.StreamIterator, error) {
	prepared, err := r.prepareLangWatchCall(ctx, call, "text/event-stream")
	if err != nil {
		return nil, err
	}

	started := time.Now()
	resp, err := r.langWatchClient.Do(prepared.request)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderConnectionFailed, herr.M{
			"reason": fmt.Sprintf("langwatch stream dispatch: %v", err),
		})
	}
	r.logLangWatchCall(prepared.bareModel, resp.StatusCode, time.Since(started))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer func() { _ = resp.Body.Close() }()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
		return nil, &domain.UpstreamError{
			StatusCode: resp.StatusCode,
			Body:       raw,
			Message:    fmt.Sprintf("langwatch gateway HTTP %d", resp.StatusCode),
			Headers:    langWatchForwardHeaders(resp.Header),
		}
	}
	return &langWatchStreamIterator{body: resp.Body, reader: bufio.NewReader(resp.Body)}, nil
}

// preparedLangWatchCall is a built request plus the bare model name, which the
// log line names and the body carries.
type preparedLangWatchCall struct {
	request   *http.Request
	bareModel string
}

// prepareLangWatchCall resolves the endpoint, rewrites the model to its bare
// name and builds the outbound request.
func (r *BifrostRouter) prepareLangWatchCall(
	ctx context.Context,
	call langWatchDispatch,
	accept string,
) (preparedLangWatchCall, error) {
	endpoint, err := langWatchEndpoint(ctx, call)
	if err != nil {
		return preparedLangWatchCall{}, err
	}
	bare := strings.TrimPrefix(call.model, langWatchModelPrefix)
	body, err := langWatchRequestBody(ctx, call.req.Body, bare)
	if err != nil {
		return preparedLangWatchCall{}, err
	}
	request, err := buildLangWatchRequest(ctx, langWatchCall{
		endpoint: endpoint,
		body:     body,
		cred:     call.cred,
		accept:   accept,
	})
	if err != nil {
		return preparedLangWatchCall{}, err
	}
	return preparedLangWatchCall{request: request, bareModel: bare}, nil
}

// buildLangWatchRequest stamps the license bearer and the instance id on the
// outbound request. Both are credentials of the install, not of the caller, so
// nothing the caller sent can set either.
func buildLangWatchRequest(ctx context.Context, call langWatchCall) (*http.Request, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		call.endpoint,
		bytes.NewReader(call.body),
	)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"reason": fmt.Sprintf("langwatch request: %v", err),
		})
	}
	request.Header.Set("Authorization", "Bearer "+call.cred.APIKey)
	if instanceID := call.cred.Extra["instance_id"]; instanceID != "" {
		request.Header.Set(langWatchInstanceHeader, instanceID)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", call.accept)
	return request, nil
}

// langWatchRequestBody forwards the caller's body with the model rewritten to
// its bare name, so the gateway stays in control of what lands upstream
// whatever the caller wrote in the body.
func langWatchRequestBody(ctx context.Context, raw []byte, bare string) ([]byte, error) {
	body := raw
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte("{}")
	}
	if bare == "" {
		return body, nil
	}
	out, err := sjson.SetBytes(body, "model", bare)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"reason": fmt.Sprintf("rewrite model on langwatch body: %v", err),
		})
	}
	return out, nil
}

// langWatchEndpoint is the URL this request is forwarded to: the configured
// base URL plus the path that serves the inbound request type.
func langWatchEndpoint(ctx context.Context, call langWatchDispatch) (string, error) {
	path, ok := langWatchPaths[call.req.Type]
	if !ok {
		return "", herr.New(ctx, domain.ErrBadRequest, herr.M{
			"reason": fmt.Sprintf(
				"the langwatch provider does not serve %s requests",
				call.req.Type,
			),
		})
	}
	base, err := langWatchBaseURL(ctx, call.cred)
	if err != nil {
		return "", err
	}
	return base + path, nil
}

// langWatchBaseURL reads the endpoint off the credential and refuses one that
// would carry the license token in the clear. Plain HTTP is allowed only on
// loopback, where a developer runs both gateways on one machine.
func langWatchBaseURL(ctx context.Context, cred domain.Credential) (string, error) {
	raw := strings.TrimRight(strings.TrimSpace(credBaseURL(cred)), "/")
	if raw == "" {
		return "", langWatchCredentialRefusal(ctx, "the langwatch provider has no endpoint configured")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return "", langWatchCredentialRefusal(ctx, "the langwatch provider's endpoint is not a valid URL")
	}
	if strings.EqualFold(parsed.Scheme, "https") {
		return raw, nil
	}
	if _, loopback := langWatchLoopbackHosts[strings.ToLower(parsed.Hostname())]; loopback {
		return raw, nil
	}
	return "", langWatchCredentialRefusal(ctx,
		"the langwatch provider's endpoint must use https: a license token must not travel unencrypted")
}

// langWatchCredentialRefusal is the terminal answer for a provider whose
// endpoint cannot be used. The same code every other unusable provider
// credential gets, so it is terminal on the fallback walk and points the
// operator at their own model provider settings.
func langWatchCredentialRefusal(ctx context.Context, reason string) error {
	return herr.New(ctx, domain.ErrProviderCredentialInvalid, herr.M{
		"message": reason,
		"fault":   "customer",
	})
}

// langWatchForwardHeaders carries back the headers the install's caller needs
// to read the answer correctly: the handled-error marker, so a refusal the far
// side authored is recognized as one, and the retry signals.
func langWatchForwardHeaders(header http.Header) map[string]string {
	out := map[string]string{}
	for _, name := range []string{herr.HandledErrorHeader, "Retry-After", "x-should-retry"} {
		if value := header.Get(name); value != "" {
			out[name] = value
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// langWatchUsage reads token usage off an answered body in the OpenAI shape
// both gateways speak. A refused call reports none.
func langWatchUsage(body []byte, status int) domain.Usage {
	if status < 200 || status >= 300 {
		return domain.Usage{}
	}
	usage := gjson.GetBytes(body, "usage")
	if !usage.Exists() {
		return domain.Usage{}
	}
	in := int(usage.Get("prompt_tokens").Int())
	out := int(usage.Get("completion_tokens").Int())
	total := int(usage.Get("total_tokens").Int())
	if total == 0 {
		total = in + out
	}
	return domain.Usage{
		PromptTokens:     in,
		CompletionTokens: out,
		TotalTokens:      total,
		CacheReadTokens:  int(usage.Get("prompt_tokens_details.cached_tokens").Int()),
	}
}

// logLangWatchCall records what a forwarded call did. The model, the status
// and how long it took, and nothing else: the license token is a bearer
// credential and a log line is the easiest place to leak one.
func (r *BifrostRouter) logLangWatchCall(model string, status int, elapsed time.Duration) {
	if r.logger == nil {
		return
	}
	r.logger.Debug("langwatch_dispatch",
		zap.String("model", model),
		zap.Int("status", status),
		zap.Duration("duration", elapsed),
	)
}
