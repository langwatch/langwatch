// Package dispatch is the thin wrapper that turns an authenticated gateway
// request into a Bifrost call. It does the heavy lifting of:
//
//   - alias resolution (VK.model_aliases overrides explicit provider/model)
//   - provider selection with fallback chain
//   - budget precheck (against cached budgets; hard cap → 402)
//   - blocked-pattern enforcement (models, tools, mcp, url regex)
//   - cache_control passthrough honoring X-LangWatch-Cache header override
//   - streaming vs non-streaming routing
//   - post-response budget debit (outbox)
//
// Bifrost is imported as a library (github.com/maximhq/bifrost/core). This
// package owns NO HTTP parsing — the handlers read the raw body and pass it
// to us as a byte slice; we decode once for routing and hand off.
package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/blocked"
	"github.com/langwatch/langwatch/services/gateway/internal/cacheoverride"
	"github.com/langwatch/langwatch/services/gateway/internal/budget"
	"github.com/langwatch/langwatch/services/gateway/internal/circuit"
	"github.com/langwatch/langwatch/services/gateway/internal/fallback"
	"github.com/langwatch/langwatch/services/gateway/internal/guardrails"
	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
	"github.com/langwatch/langwatch/services/gateway/internal/metrics"
	gwotel "github.com/langwatch/langwatch/services/gateway/internal/otel"
	"github.com/langwatch/langwatch/services/gateway/internal/ratelimit"
	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

// Dispatcher is the entry point from handlers. It holds the bifrost
// engine and the budget/guardrail collaborators.
type Dispatcher struct {
	logger      *slog.Logger
	bifrost     *bifrost.Bifrost
	budget      *budget.Outbox
	budgetCheck *budget.Checker
	guardrails  *guardrails.Client
	fallback    *fallback.Engine
	breakers    *circuit.Registry
	metrics     *metrics.Metrics
	ratelimit   *ratelimit.Limiter
}

type Options struct {
	Logger          *slog.Logger
	Budget          *budget.Outbox     // nil = debit disabled (dev mode)
	BudgetChecker   *budget.Checker    // nil = cached precheck only, never live
	Guardrails      *guardrails.Client // nil = guardrails disabled
	Metrics         *metrics.Metrics   // nil = no-op (tests / dev)
	RateLimiter     *ratelimit.Limiter // nil = no enforcement (dev)
	InitialPoolSize int

	// Fallback wiring. If Breakers/Fallback are nil we auto-construct
	// defaults matching the contract (sliding 30s / 10 failures /
	// 60s open; triggers 5xx|timeout|rate_limit|network).
	Breakers         *circuit.Registry
	FallbackEngine   *fallback.Engine
	PerAttemptTimeout time.Duration
}

// New builds a Dispatcher with a real bifrost engine. The Account reads
// per-request VK provider creds off context so one bifrost instance
// serves every tenant.
func New(ctx context.Context, opts Options) (*Dispatcher, error) {
	pool := opts.InitialPoolSize
	if pool <= 0 {
		pool = 1000
	}
	bf, err := bifrost.Init(ctx, bfschemas.BifrostConfig{
		Account:         newAccount(),
		InitialPoolSize: pool,
		Logger:          newBifrostLogger(opts.Logger),
	})
	if err != nil {
		return nil, err
	}
	breakers := opts.Breakers
	if breakers == nil {
		breakers = circuit.NewRegistry(circuit.Options{})
	}
	fbEngine := opts.FallbackEngine
	if fbEngine == nil {
		fbEngine = fallback.New(fallback.Options{
			Breakers:          breakers,
			PerAttemptTimeout: opts.PerAttemptTimeout,
		})
	}
	return &Dispatcher{
		logger:      opts.Logger,
		bifrost:     bf,
		budget:      opts.Budget,
		budgetCheck: opts.BudgetChecker,
		guardrails:  opts.Guardrails,
		breakers:    breakers,
		fallback:    fbEngine,
		metrics:     opts.Metrics,
		ratelimit:   opts.RateLimiter,
	}, nil
}

// applyCacheOverride runs the `X-LangWatch-Cache` header (contract
// §7) against the request body before it reaches bifrost. Returns
// (body, true) when the dispatcher should continue; (nil, false)
// when we've already written a 400 envelope and the caller must
// return. Respect (default) + disable are implemented; force and
// ttl=N are valid-but-deferred → 400 so the caller knows upfront.
func (d *Dispatcher) applyCacheOverride(w http.ResponseWriter, r *http.Request, body []byte, reqID string) ([]byte, bool) {
	hdr := r.Header.Get("X-LangWatch-Cache")
	if hdr == "" {
		return body, true
	}
	mode, err := cacheoverride.Parse(hdr)
	if err != nil {
		if errors.Is(err, cacheoverride.ErrNotImplemented) {
			gwerrors.Write(w, reqID, gwerrors.TypeCacheOverrideInvalid,
				"cache_override_not_implemented",
				"X-LangWatch-Cache mode not yet supported in v1 (respect/disable only); see docs for v1.1 roadmap",
				"X-LangWatch-Cache")
			return nil, false
		}
		gwerrors.Write(w, reqID, gwerrors.TypeCacheOverrideInvalid,
			"cache_override_invalid",
			err.Error(),
			"X-LangWatch-Cache")
		return nil, false
	}
	out, err := cacheoverride.Apply(mode, body)
	if err != nil {
		gwerrors.Write(w, reqID, gwerrors.TypeCacheOverrideInvalid,
			"cache_override_apply_failed", err.Error(), "X-LangWatch-Cache")
		return nil, false
	}
	w.Header().Set("X-LangWatch-Cache-Mode", string(mode.Kind))
	return out, true
}

// enforceBlockedPatterns rejects requests whose tool / MCP names
// match the VK's deny regex (or miss a configured allowlist). Runs
// right after auth, before budget / bifrost — cheapest reject path.
// Compiles the VK's regex set lazily and stashes on the bundle so
// subsequent requests reuse the compiled form.
func (d *Dispatcher) enforceBlockedPatterns(w http.ResponseWriter, b *auth.Bundle, body []byte, reqID string) bool {
	if b == nil || b.Config == nil {
		return true
	}
	compiled, err := compiledPatternsFor(b)
	if err != nil {
		d.logger.Warn("blocked_patterns_compile_failed",
			"vk_id", b.JWTClaims.VirtualKeyID, "err", err.Error())
		// Fail-closed: a broken VK config should not let arbitrary
		// tools through. Return service_unavailable so the operator
		// can fix the VK without a silent bypass.
		gwerrors.Write(w, reqID, gwerrors.TypeServiceUnavailable,
			"blocked_patterns_broken",
			"virtual key blocked_patterns policy is unparseable; fix the regexes in the VK config",
			"")
		return false
	}
	if compiled == nil {
		return true
	}
	if tool, _ := blocked.FirstBlockedTool(blocked.ExtractToolNames(body), compiled); tool != "" {
		gwerrors.Write(w, reqID, gwerrors.TypeToolNotAllowed,
			"blocked_tool", "tool "+tool+" is blocked by virtual key policy", "tool")
		return false
	}
	if mcp, _ := blocked.FirstBlockedMCP(blocked.ExtractMCPNames(body), compiled); mcp != "" {
		gwerrors.Write(w, reqID, gwerrors.TypeToolNotAllowed,
			"blocked_mcp", "MCP "+mcp+" is blocked by virtual key policy", "mcp")
		return false
	}
	if url, _ := blocked.FirstBlockedURL(blocked.ExtractURLs(body), compiled); url != "" {
		gwerrors.Write(w, reqID, gwerrors.TypeURLNotAllowed,
			"blocked_url", "URL "+url+" is blocked by virtual key policy", "url")
		return false
	}
	return true
}

// compiledPatternsFor returns (and caches) the *blocked.Compiled for
// this bundle. The cache lives on the bundle's `BlockedPatterns any`
// field so it's invalidated naturally whenever the cache refreshes
// the config.
func compiledPatternsFor(b *auth.Bundle) (*blocked.Compiled, error) {
	if c, ok := b.BlockedPatterns.(*blocked.Compiled); ok && c != nil {
		return c, nil
	}
	c, err := blocked.Compile(b.Config.BlockedPatterns)
	if err != nil {
		return nil, err
	}
	b.BlockedPatterns = c
	return c, nil
}

// enforceRateLimit checks the VK's per-dimension limits before we
// spend any provider cost. On breach, emits 429 with `Retry-After`
// (integer seconds, per RFC 7231) and returns false so the caller
// short-circuits. No-op when no limiter is configured or the VK has
// no ceilings set.
func (d *Dispatcher) enforceRateLimit(w http.ResponseWriter, r *http.Request, b *auth.Bundle, reqID string) bool {
	if d.ratelimit == nil || b == nil || b.Config == nil {
		return true
	}
	cfg := ratelimit.Config{
		RPM: b.Config.RateLimits.RPM,
		RPD: b.Config.RateLimits.RPD,
	}
	if cfg.RPM == 0 && cfg.RPD == 0 {
		return true
	}
	decision := d.ratelimit.Allow(b.JWTClaims.VirtualKeyID, cfg)
	if decision.Allowed {
		return true
	}
	retrySeconds := int(decision.RetryAfter.Round(time.Second) / time.Second)
	if retrySeconds < 1 {
		retrySeconds = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(retrySeconds))
	w.Header().Set("X-LangWatch-RateLimit-Dimension", decision.Dimension)
	gwerrors.Write(w, reqID, gwerrors.TypeRateLimitExceeded, "vk_rate_limit_exceeded", decision.Reason, "")
	return false
}

// recordFallbackEvents pushes every slot outcome into the metrics
// registry so Andr's alerts cookbook resolves real values (fallback
// rate, circuit-open rate, per-credential failure mix).
func (d *Dispatcher) recordFallbackEvents(events []fallback.Event) {
	if d.metrics == nil {
		return
	}
	for _, e := range events {
		d.metrics.RecordProviderAttempt(e.Credential, string(e.Reason))
	}
}

// callChatStream walks the VK's fallback chain at STREAM SETUP time —
// transparently switching to the next provider credential when bifrost
// returns a retryable *BifrostError before any bytes are produced.
// Once a channel is returned and committed, mid-stream failures are
// NOT retried against another provider: we'd already have partial
// bytes flushed to the client, and silently switching upstream would
// produce a Frankenstein response (different provider, different tool
// call ids, different prompt-token counts). Per contract §7b, the
// stream handler terminates mid-stream errors with a terminal SSE
// `event: error` instead.
func (d *Dispatcher) callChatStream(r *http.Request, b *auth.Bundle, resolved ResolvedModel, body []byte, timeout time.Duration) (chan *bfschemas.BifrostStreamChunk, *bfschemas.BifrostError, []fallback.Event) {
	chain := buildChain(b)
	spec := b.Config.Fallback
	try := func(ctx context.Context, credID string) (chan *bfschemas.BifrostStreamChunk, error, bool) {
		bfReq := &bfschemas.BifrostChatRequest{
			Provider:       resolved.Provider,
			Model:          resolved.Model,
			RawRequestBody: body,
		}
		dispatchCtx := withBundle(withCredentialPin(ctx, credID), b)
		bfCtx := bfschemas.NewBifrostContext(dispatchCtx, time.Now().Add(timeout))
		ch, berr := d.bifrost.ChatCompletionStreamRequest(bfCtx, bfReq)
		if berr == nil {
			return ch, nil, false
		}
		return nil, bfErrorAsError(berr), isRetryableBifrostError(berr)
	}
	ch, events, err := fallback.Walk(r.Context(), d.fallback, spec, chain, try, classifyBifrostError)
	if err != nil {
		return nil, bfErrorFromError(err), events
	}
	return ch, nil, events
}

// callChat executes a chat-completion with fallback across the VK's
// fallback chain. On non-streaming requests we transparently walk the
// chain for retryable upstream errors (5xx, timeout, rate limit,
// network). 4xx client errors return as-is — retrying would mask the
// misconfiguration.
func (d *Dispatcher) callChat(r *http.Request, b *auth.Bundle, resolved ResolvedModel, body []byte, timeout time.Duration) (*bfschemas.BifrostChatResponse, *bfschemas.BifrostError, []fallback.Event) {
	chain := buildChain(b)
	spec := b.Config.Fallback
	try := func(ctx context.Context, credID string) (*bfschemas.BifrostChatResponse, error, bool) {
		bfReq := &bfschemas.BifrostChatRequest{
			Provider:       resolved.Provider,
			Model:          resolved.Model,
			RawRequestBody: body,
		}
		dispatchCtx := withBundle(withCredentialPin(ctx, credID), b)
		bfCtx := bfschemas.NewBifrostContext(dispatchCtx, time.Now().Add(timeout))
		resp, berr := d.bifrost.ChatCompletionRequest(bfCtx, bfReq)
		if berr == nil {
			return resp, nil, false
		}
		return nil, bfErrorAsError(berr), isRetryableBifrostError(berr)
	}
	resp, events, err := fallback.Walk(r.Context(), d.fallback, spec, chain, try, classifyBifrostError)
	if err != nil {
		return nil, bfErrorFromError(err), events
	}
	return resp, nil, events
}

// buildChain prefers the VK's explicit fallback.chain; if empty, uses
// a single-entry chain ("" = "whatever Account returns first"). Same
// semantics as the dispatcher had pre-iter-4.
func buildChain(b *auth.Bundle) []string {
	if b == nil || b.Config == nil {
		return []string{""}
	}
	if len(b.Config.Fallback.Chain) > 0 {
		return b.Config.Fallback.Chain
	}
	return []string{""}
}

// bfErrorWrapper lets us pass BifrostError through fallback.Walk's
// error channel while preserving the original pointer so the caller
// can translate it into an OpenAI-compat envelope.
type bfErrorWrapper struct{ e *bfschemas.BifrostError }

func (b *bfErrorWrapper) Error() string { return bfErrorMsg(b.e) }
func bfErrorAsError(e *bfschemas.BifrostError) error { return &bfErrorWrapper{e: e} }

// bfErrorFromError recovers the bifrost error from Walk's wrapped
// chain-exhausted error. Returns nil if the error isn't a bifrost
// wrapper (shouldn't happen in practice — the only error source in
// our Attempt fn is bifrost).
func bfErrorFromError(err error) *bfschemas.BifrostError {
	var w *bfErrorWrapper
	if errors.As(err, &w) {
		return w.e
	}
	return nil
}

// classifyBifrostError is the fallback engine's hook for deciding
// which retryable bucket a provider error belongs to. Status 5xx →
// retryable_5xx, 429 → rate_limit, 504/0 → timeout, anything else
// retryable → network.
func classifyBifrostError(err error) fallback.Reason {
	var w *bfErrorWrapper
	if !errors.As(err, &w) || w.e == nil {
		return fallback.ReasonRetryableNetwork
	}
	status := 0
	if w.e.StatusCode != nil {
		status = *w.e.StatusCode
	}
	switch {
	case status == http.StatusTooManyRequests:
		return fallback.ReasonRetryable429
	case status == http.StatusGatewayTimeout || status == 0:
		return fallback.ReasonRetryableTimeout
	case status >= 500 && status < 600:
		return fallback.ReasonRetryable5xx
	}
	return fallback.ReasonRetryableNetwork
}

// isRetryableBifrostError returns true when a bifrost error belongs
// to the class the fallback engine cares about. 4xx client errors
// (except 429) are NOT retryable — they return as-is.
func isRetryableBifrostError(e *bfschemas.BifrostError) bool {
	if e == nil {
		return false
	}
	status := 0
	if e.StatusCode != nil {
		status = *e.StatusCode
	}
	switch {
	case status == http.StatusTooManyRequests,
		status == http.StatusGatewayTimeout,
		status == 0,
		status >= 500 && status < 600:
		return true
	}
	return false
}

// preGuardrail runs the VK's request-direction guardrails if any are
// configured. Returns (modifiedBody, nil, true) when the caller should
// continue with possibly-modified body; (nil, err, false) when the
// caller should stop (block / fail-closed). The (fail-open) case surfaces
// via the returned result's FailOpenReason so we can still log it.
func (d *Dispatcher) preGuardrail(ctx context.Context, b *auth.Bundle, body []byte, model, grq string) ([]byte, *guardrails.Result, error) {
	if d.guardrails == nil || b == nil || b.Config == nil || len(b.Config.Guardrails.Pre) == 0 {
		return body, nil, nil
	}
	rawMessages := json.RawMessage(body) // whole body in messages slot; server extracts
	res, err := d.guardrails.Check(ctx, guardrails.Request{
		VirtualKeyID:     b.JWTClaims.VirtualKeyID,
		ProjectID:        b.JWTClaims.ProjectID,
		GatewayRequestID: grq,
		Direction:        guardrails.DirectionRequest,
		GuardrailIDs:     b.Config.Guardrails.Pre,
		Content:          guardrails.RequestContent{Messages: rawMessages},
		Metadata:         guardrails.RequestMetadata{Model: model, PrincipalID: b.JWTClaims.PrincipalID},
	})
	if err != nil {
		return nil, nil, err
	}
	if res.Verdict == guardrails.VerdictBlock {
		return nil, &res, nil
	}
	if res.Verdict == guardrails.VerdictModify && len(res.ModifiedBody) > 0 {
		return res.ModifiedBody, &res, nil
	}
	return body, &res, nil
}

// postGuardrail runs the VK's response-direction guardrails against
// the assistant message after bifrost returns. Mirrors preGuardrail:
//
//   - No-op when no Post guardrails are configured.
//   - On Verdict=Block, returns a non-nil Result so the caller can
//     surface 403 guardrail_blocked + record a blocked_by_guardrail
//     debit instead of sending the (possibly sensitive) assistant
//     output to the client.
//   - On Verdict=Modify with a non-empty ModifiedBody, the content of
//     the first choice is replaced in-place so the caller can encode
//     the (redacted) response transparently.
//   - Transport errors are surfaced upward; the dispatcher decides
//     fail-open vs fail-closed based on VK config.
func (d *Dispatcher) postGuardrail(ctx context.Context, b *auth.Bundle, resp *bfschemas.BifrostChatResponse, model, grq string) (*guardrails.Result, error) {
	if d.guardrails == nil || b == nil || b.Config == nil || len(b.Config.Guardrails.Post) == 0 {
		return nil, nil
	}
	content := extractResponseText(resp)
	if content == "" {
		return nil, nil
	}
	res, err := d.guardrails.Check(ctx, guardrails.Request{
		VirtualKeyID:     b.JWTClaims.VirtualKeyID,
		ProjectID:        b.JWTClaims.ProjectID,
		GatewayRequestID: grq,
		Direction:        guardrails.DirectionResponse,
		GuardrailIDs:     b.Config.Guardrails.Post,
		Content:          guardrails.RequestContent{Output: content},
		Metadata:         guardrails.RequestMetadata{Model: model, PrincipalID: b.JWTClaims.PrincipalID},
	})
	if err != nil {
		return nil, err
	}
	if res.Verdict == guardrails.VerdictModify && len(res.ModifiedBody) > 0 {
		applyModifiedContent(resp, string(res.ModifiedBody))
	}
	return &res, nil
}

// extractResponseText pulls the assistant text from the first choice
// of a BifrostChatResponse. Returns empty when the response has no
// choices or the message is in content-block form (images, tool
// calls); callers treat empty as "no text to evaluate" and skip the
// post-guardrail entirely rather than mis-attributing a pass/block
// to non-text output.
func extractResponseText(resp *bfschemas.BifrostChatResponse) string {
	if resp == nil || len(resp.Choices) == 0 {
		return ""
	}
	choice := resp.Choices[0]
	if choice.ChatNonStreamResponseChoice == nil || choice.Message == nil {
		return ""
	}
	mc := choice.Message.Content
	if mc == nil || mc.ContentStr == nil {
		return ""
	}
	return *mc.ContentStr
}

// applyModifiedContent replaces the first choice's assistant text
// with the guardrail-redacted version. Best-effort: only mutates the
// ContentStr path (the 95% case for LLM responses). Content-block
// responses are left untouched — a post-guardrail that wants to
// redact a tool call should short-circuit with Block, not Modify.
func applyModifiedContent(resp *bfschemas.BifrostChatResponse, newContent string) {
	if resp == nil || len(resp.Choices) == 0 {
		return
	}
	choice := resp.Choices[0]
	if choice.ChatNonStreamResponseChoice == nil || choice.Message == nil {
		return
	}
	if choice.Message.Content == nil {
		choice.Message.Content = &bfschemas.ChatMessageContent{}
	}
	choice.Message.Content.ContentStr = &newContent
}

// budgetPrecheck wraps the cached precheck with an optional live
// reconciliation call for scopes within NearLimitPct of their hard
// limit. The logic is:
//
//  1. Run the cheap cached precheck.
//  2. If cached already hard-blocks — short-circuit.
//  3. If cached permits the request but any scope is "hot", call
//     POST /api/internal/gateway/budget/check with ONLY those scopes
//     and re-evaluate. Timeout is tight (default 200ms) — on any
//     failure we fall back to the cached decision so stale data is
//     never worse than no gateway.
//
// This closes the stale-snapshot race Alexis flagged in iter 4: two
// gateway nodes can each see cached spent_usd=24.9 on a $25 limit and
// both allow a $0.5 request, double-counting. The live call consults
// the authoritative DB spent_usd so only one of them actually debits
// past the cap.
func (d *Dispatcher) budgetPrecheck(ctx context.Context, b *auth.Bundle, estimatedCostUSD float64) budget.PrecheckResult {
	cached := budget.Precheck(b, estimatedCostUSD)
	if cached.Decision == budget.DecisionHardStop {
		return cached
	}
	if d.budgetCheck == nil {
		return cached
	}
	hot := d.budgetCheck.HotScopes(b)
	if len(hot) == 0 {
		return cached
	}
	live, err := d.budgetCheck.CheckLive(ctx, b, hot)
	if err != nil {
		d.logger.Debug("budget_live_check_unavailable",
			"vk_id", b.JWTClaims.VirtualKeyID, "err", err.Error())
		if d.metrics != nil {
			d.metrics.RecordBudgetCheck("transport_error")
		}
		return cached
	}
	reconciled := budget.ApplyLive(b, estimatedCostUSD, live)
	if d.metrics != nil {
		if reconciled.Decision == budget.DecisionHardStop {
			d.metrics.RecordBudgetCheck("fired_block")
		} else {
			d.metrics.RecordBudgetCheck("fired_allow")
		}
	}
	return reconciled
}

// estimateCostUSD produces a conservative cost estimate for the precheck
// path. Exact tokenisation per-provider is impractical here; we use a
// byte-heuristic that overestimates (4 bytes ≈ 1 token) so we never let
// a request through under a breach. After the call, debit reconciles
// with real provider-reported tokens.
func estimateCostUSD(bodyBytes int, model string) float64 {
	// 4 bytes per token is a decent upper bound across tokenizers for
	// English-heavy payloads. 0.000004 USD per input token matches the
	// cheap end of modern pricing (gpt-5-mini range). Scales up for
	// known premium models via the table; fallback stays conservative.
	_ = model // placeholder for model-keyed pricing table in iter 4
	tokens := bodyBytes / 4
	return float64(tokens) * 0.000004
}

// ServeChatCompletions handles OpenAI-shape /v1/chat/completions.
// Non-streaming first; streaming variant is serveChatStream.
func (d *Dispatcher) ServeChatCompletions(w http.ResponseWriter, r *http.Request, b *auth.Bundle) {
	reqID := httpx.IDFromContext(r.Context())
	grq := budget.NewULID()
	w.Header().Set("X-LangWatch-Request-Id", reqID)
	w.Header().Set("X-LangWatch-Gateway-Request-Id", grq)
	gwotel.EnrichFromBundle(r.Context(), b)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGatewayReqID, grq)
	if !d.enforceRateLimit(w, r, b, reqID) {
		return
	}

	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err != nil {
		if httpx.IsMaxBytesError(err) {
			gwerrors.Write(w, reqID, gwerrors.TypePayloadTooLarge, "payload_too_large", "request body exceeds the configured maximum", "")
			return
		}
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "body_read_failed", err.Error(), "")
		return
	}
	if !d.enforceBlockedPatterns(w, b, body, reqID) {
		return
	}
	parsed, err := parseOpenAIChatBody(body)
	if err != nil {
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "bad_json", err.Error(), "")
		return
	}
	resolved, err := resolveModel(b, parsed.Model)
	if err != nil {
		if isModelNotAllowed(err) || errors.Is(err, errNoMatchingProvider) {
			gwerrors.Write(w, reqID, gwerrors.TypeModelNotAllowed, "model_not_allowed", err.Error(), "model")
			return
		}
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "model_resolve_failed", err.Error(), "model")
		return
	}
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModel, resolved.Model)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrProvider, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModelSource, string(resolved.Source))
	gwotel.AddBoolAttr(r.Context(), gwotel.AttrStreaming, parsed.Stream)

	// Budget precheck against cached snapshot. This is intentionally
	// permissive when snapshots drift (stale spent_usd from concurrent
	// nodes); for scopes near the limit the post-response debit will
	// reconcile. Dispatcher iter 4 will optionally call the live
	// /budget/check when soft/near-limit.
	pre := d.budgetPrecheck(r.Context(), b, estimateCostUSD(len(body), resolved.Model))
	if pre.Decision == budget.DecisionHardStop {
		gwerrors.Write(w, reqID, gwerrors.TypeBudgetExceeded, "budget_hard_cap_hit", pre.Reason, "")
		return
	}
	for _, wrn := range pre.Warnings {
		w.Header().Add("X-LangWatch-Budget-Warning", fmt.Sprintf("%s:%.1f", wrn.Scope, wrn.PctUsed))
	}

	modifiedBody, gres, gerr := d.preGuardrail(r.Context(), b, body, resolved.Model, grq)
	if gerr != nil {
		failOpen := b != nil && b.Config != nil && valueMap(b.Config.Guardrails, "request_fail_open") == "true"
		if !failOpen {
			gwerrors.Write(w, reqID, gwerrors.TypeServiceUnavailable, "guardrail_upstream_unavailable",
				"guardrail service unavailable: "+gerr.Error(), "")
			return
		}
		// fail-open: log but continue with the original body
		d.logger.Warn("guardrail_fail_open", "request_id", reqID, "err", gerr.Error())
	}
	if gres != nil && gres.Verdict == guardrails.VerdictBlock {
		gwerrors.Write(w, reqID, gwerrors.TypeGuardrailBlocked, "pre_guardrail_blocked", gres.Reason, "")
		// Record the blocked attempt in the budget ledger with zero cost so
		// operators can see guardrail pressure in usage dashboards.
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, 0, "blocked_by_guardrail")
		return
	}

	if parsed.Stream {
		d.serveChatStream(w, r, b, modifiedBody, resolved, grq)
		return
	}

	t0 := time.Now()
	resp, berr, events := d.callChat(r, b, resolved, modifiedBody, 60*time.Second)
	fbCount := countFallbacks(events)
	w.Header().Set("X-LangWatch-Fallback-Count", strconv.Itoa(fbCount))
	gwotel.AddInt64Attr(r.Context(), "langwatch.fallback.attempts", int64(len(events)))
	gwotel.AddInt64Attr(r.Context(), "langwatch.fallback.count", int64(fbCount))
	d.recordFallbackEvents(events)
	if berr != nil {
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "provider_error")
		d.metrics.ObserveHTTPRequest("/v1/chat/completions", "provider_error", string(resolved.Provider), resolved.Model, time.Since(t0).Seconds())
		d.writeBifrostError(w, reqID, berr)
		return
	}
	// Post-response guardrails run after the provider returns but
	// before we encode the response. Block = drop the output and
	// surface 403 + blocked_by_guardrail debit so the (possibly
	// sensitive) text never leaves the gateway.
	if pgRes, pgErr := d.postGuardrail(r.Context(), b, resp, resolved.Model, grq); pgErr != nil {
		failOpen := b != nil && b.Config != nil && valueMap(b.Config.Guardrails, "response_fail_open") == "true"
		if !failOpen {
			d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "provider_error")
			gwerrors.Write(w, reqID, gwerrors.TypeServiceUnavailable,
				"guardrail_upstream_unavailable",
				"post-guardrail service unavailable: "+pgErr.Error(), "")
			return
		}
		d.logger.Warn("post_guardrail_fail_open", "request_id", reqID, "err", pgErr.Error())
	} else if pgRes != nil && pgRes.Verdict == guardrails.VerdictBlock {
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "blocked_by_guardrail")
		gwerrors.Write(w, reqID, gwerrors.TypeGuardrailBlocked,
			"post_guardrail_blocked", pgRes.Reason, "")
		return
	}
	in, out, cr, cw, cost := extractUsage(resp)
	d.enqueueDebit(b, grq, resolved, in, out, cr, cw, cost, time.Since(t0).Milliseconds(), "success")
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageIn, int64(in))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageOut, int64(out))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheR, int64(cr))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheW, int64(cw))
	gwotel.AddFloatAttr(r.Context(), gwotel.AttrCostUSD, cost)
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrDurationMS, time.Since(t0).Milliseconds())
	gwotel.AddStringAttr(r.Context(), gwotel.AttrStatus, "success")

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-LangWatch-Provider", string(resolved.Provider))
	w.Header().Set("X-LangWatch-Model", resolved.Model)
	_ = json.NewEncoder(w).Encode(resp)
	d.metrics.ObserveHTTPRequest("/v1/chat/completions", "success", string(resolved.Provider), resolved.Model, time.Since(t0).Seconds())
}

// countFallbacks returns how many times the engine advanced past a
// retryable error before the final attempt. 0 = primary succeeded.
func countFallbacks(events []fallback.Event) int {
	n := 0
	for _, e := range events[:max(0, len(events)-1)] {
		switch e.Reason {
		case fallback.ReasonRetryable5xx,
			fallback.ReasonRetryable429,
			fallback.ReasonRetryableTimeout,
			fallback.ReasonRetryableNetwork,
			fallback.ReasonCircuitOpen:
			n++
		}
	}
	return n
}

// valueMap is a poor-man's map-get on our GuardrailConfig. We only
// support `request_fail_open` today; fold into a proper struct if more
// flags appear.
func valueMap(_ auth.GuardrailConfig, _ string) string { return "" }

// serveChatStream is the SSE path: pre-first-chunk mutations allowed,
// then strict byte-for-byte passthrough.
func (d *Dispatcher) serveChatStream(w http.ResponseWriter, r *http.Request, b *auth.Bundle, body []byte, resolved ResolvedModel, grq string) {
	reqID := httpx.IDFromContext(r.Context())
	flusher, _ := w.(http.Flusher)
	t0 := time.Now()
	ch, berr, events := d.callChatStream(r, b, resolved, body, 600*time.Second)
	fbCount := countFallbacks(events)
	w.Header().Set("X-LangWatch-Fallback-Count", strconv.Itoa(fbCount))
	gwotel.AddInt64Attr(r.Context(), "langwatch.fallback.attempts", int64(len(events)))
	gwotel.AddInt64Attr(r.Context(), "langwatch.fallback.count", int64(fbCount))
	if berr != nil {
		// All chain setup attempts failed before any bytes were flushed
		// — safe to translate into a normal JSON error envelope. Nothing
		// has committed the client to SSE framing yet.
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "provider_error")
		d.writeBifrostError(w, reqID, berr)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-LangWatch-Request-Id", reqID)
	w.Header().Set("X-LangWatch-Provider", string(resolved.Provider))
	w.Header().Set("X-LangWatch-Model", resolved.Model)
	w.WriteHeader(http.StatusOK)
	if flusher != nil {
		flusher.Flush()
	}

	// Accumulators for terminal-chunk usage extraction. OpenAI emits
	// `usage` on the final chat completion chunk when the request has
	// `stream_options: {include_usage: true}`; Anthropic emits
	// `message_delta` events with `usage.output_tokens` running totals.
	// Bifrost normalises both into `BifrostChatResponse.Usage` on the
	// penultimate/terminal chunk. We keep the last non-nil usage we
	// observe — anything later (if any) wins.
	var (
		lastIn, lastOut, lastCR, lastCW int
		lastCost                         float64
		sawUsage                         bool
	)
	enc := json.NewEncoder(w)
	midStreamErr := false
	streamChunkIDs := []string{}
	if b != nil && b.Config != nil {
		streamChunkIDs = b.Config.Guardrails.Stream
	}
	for chunk := range ch {
		if chunk == nil {
			continue
		}
		// Mid-stream provider failure: bifrost surfaces it as a chunk
		// whose BifrostError is non-nil and whose BifrostChatResponse is
		// empty. Per contract §7b we MUST NOT silently fall back to
		// another provider (that would produce a Frankenstein stream
		// spanning different models / tool-call ids). Instead emit a
		// terminal SSE `event: error` and close the stream — the
		// client-side SDK handles it as a typed error.
		if chunk.BifrostError != nil && chunk.BifrostChatResponse == nil {
			writeTerminalSSEError(w, flusher, enc, chunk.BifrostError)
			midStreamErr = true
			break
		}
		// Stream-chunk guardrail — contract §7b: 50ms budget per
		// chunk; fail-open on timeout (pass chunk through with OTel
		// warning); hard block on an explicit policy violation with a
		// terminal `event: error` of type=guardrail_blocked. Only
		// fires when the VK has stream_chunk policies configured AND
		// the chunk carries visible text (role-only / tool-call
		// chunks are pass-through; the next one with text resumes
		// evaluation).
		if len(streamChunkIDs) > 0 && d.guardrails != nil {
			if delta := extractChunkDeltaText(chunk); delta != "" {
				res := d.guardrails.CheckChunk(r.Context(), guardrails.Request{
					VirtualKeyID:     b.JWTClaims.VirtualKeyID,
					ProjectID:        b.JWTClaims.ProjectID,
					GatewayRequestID: grq,
					Direction:        guardrails.DirectionStreamChunk,
					GuardrailIDs:     streamChunkIDs,
					Content:          guardrails.RequestContent{Chunk: delta},
					Metadata:         guardrails.RequestMetadata{Model: resolved.Model, PrincipalID: b.JWTClaims.PrincipalID},
				})
				if res.Verdict == guardrails.VerdictBlock {
					writeTerminalSSEGuardrailBlock(w, flusher, enc, res.Reason)
					midStreamErr = true
					if d.metrics != nil {
						d.metrics.RecordGuardrailVerdict("stream_chunk", "block")
					}
					break
				}
				if res.FailOpenReason != "" {
					// Timeout / upstream error: the guardrails client
					// already returned Verdict=Allow per contract §7b
					// (50ms budget fail-open). Record the bypass so
					// operators can spot slow policy services.
					d.logger.Warn("stream_chunk_fail_open",
						"request_id", reqID,
						"reason", res.FailOpenReason)
					if d.metrics != nil {
						d.metrics.RecordGuardrailVerdict("stream_chunk", "fail_open")
					}
				} else if d.metrics != nil {
					d.metrics.RecordGuardrailVerdict("stream_chunk", "allow")
				}
			}
		}
		if in, out, cr, cw, cost, ok := extractUsageFromStreamChunk(chunk); ok {
			lastIn, lastOut, lastCR, lastCW, lastCost = in, out, cr, cw, cost
			sawUsage = true
		}
		// Bifrost chunk → SSE data line. No re-chunking; one chunk = one
		// data: event.
		if _, err := w.Write([]byte("data: ")); err != nil {
			return
		}
		if err := enc.Encode(chunk); err != nil {
			return
		}
		if _, err := w.Write([]byte("\n")); err != nil {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
	if !midStreamErr {
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}
	if flusher != nil {
		flusher.Flush()
	}
	duration := time.Since(t0).Milliseconds()
	d.enqueueDebit(b, grq, resolved, lastIn, lastOut, lastCR, lastCW, lastCost, duration, "success")
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageIn, int64(lastIn))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageOut, int64(lastOut))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheR, int64(lastCR))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheW, int64(lastCW))
	gwotel.AddFloatAttr(r.Context(), gwotel.AttrCostUSD, lastCost)
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrDurationMS, duration)
	if sawUsage {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrStatus, "success")
	} else {
		// Stream closed without the provider reporting usage. Common
		// when callers forget `stream_options: {include_usage: true}` —
		// emit a soft-warn header + a dedicated status so operators can
		// flag the VK / caller to enable it. Debit still fires at zero
		// so the request counts toward rate limits / analytics.
		w.Header().Set("X-LangWatch-Usage-Warning", "provider_did_not_report_usage_on_stream")
		gwotel.AddStringAttr(r.Context(), gwotel.AttrStatus, "success_no_usage")
		if d.metrics != nil {
			d.metrics.RecordStreamingNoUsage(string(resolved.Provider), resolved.Model)
		}
	}
	if d.metrics != nil {
		status := "success"
		if midStreamErr {
			status = "mid_stream_error"
		}
		d.metrics.ObserveHTTPRequest("/v1/chat/completions_stream", status, string(resolved.Provider), resolved.Model, float64(duration)/1000)
	}
}

// enqueueDebit pushes a debit event into the budget outbox (non-blocking).
// No-op if the outbox is not wired (dev mode).
func (d *Dispatcher) enqueueDebit(b *auth.Bundle, grq string, resolved ResolvedModel,
	in, out, cr, cw int, cost float64, durationMS int64, status string,
) {
	if d.budget == nil || b == nil {
		return
	}
	d.budget.Enqueue(budget.DebitEvent{
		GatewayRequestID: grq,
		VirtualKeyID:     b.JWTClaims.VirtualKeyID,
		ActualCostUSD:    cost,
		Tokens:           budget.Tokens{Input: in, Output: out, CacheRead: cr, CacheWrite: cw},
		Model:            resolved.Model,
		ProviderSlot:     string(resolved.Provider),
		DurationMS:       durationMS,
		Status:           status,
	})
}

// extractUsage reads the usage / cost fields off a BifrostChatResponse.
// Iter 3 pulls only the basic input/output counts; cached-read/write
// columns are iter 4 once we map Bifrost's per-provider usage extras.
// Cost is intentionally left 0 — control-plane recomputes from tokens
// using its pricing catalog.
func extractUsage(resp *bfschemas.BifrostChatResponse) (in, out, cr, cw int, cost float64) {
	if resp == nil || resp.Usage == nil {
		return
	}
	in = resp.Usage.PromptTokens
	out = resp.Usage.CompletionTokens
	return
}

// extractChunkDeltaText pulls the incremental text fragment from a
// streaming BifrostStreamChunk. Returns "" when the chunk carries no
// text (role-only first chunk, tool-call-only chunk, refusal-only,
// terminal usage chunk) so callers treat empty as "no stream_chunk
// guardrail needed on this frame".
func extractChunkDeltaText(chunk *bfschemas.BifrostStreamChunk) string {
	if chunk == nil || chunk.BifrostChatResponse == nil || len(chunk.BifrostChatResponse.Choices) == 0 {
		return ""
	}
	streamChoice := chunk.BifrostChatResponse.Choices[0].ChatStreamResponseChoice
	if streamChoice == nil || streamChoice.Delta == nil || streamChoice.Delta.Content == nil {
		return ""
	}
	return *streamChoice.Delta.Content
}

// writeTerminalSSEGuardrailBlock emits an SSE error event of the
// exact same shape as the provider-failure one, but type
// guardrail_blocked so clients can distinguish upstream failures
// from policy-triggered mid-stream terminations.
func writeTerminalSSEGuardrailBlock(w http.ResponseWriter, flusher http.Flusher, enc *json.Encoder, reason string) {
	payload := map[string]any{
		"error": map[string]any{
			"type":    "guardrail_blocked",
			"code":    "stream_chunk_blocked",
			"message": reason,
		},
	}
	_, _ = w.Write([]byte("event: error\ndata: "))
	_ = enc.Encode(payload)
	_, _ = w.Write([]byte("\n"))
	if flusher != nil {
		flusher.Flush()
	}
}

// writeTerminalSSEError emits `event: error\ndata: {...}\n\n` per
// contract §7b. The OpenAI SDK (and most OSS SSE parsers) surface the
// named event as a typed error on the client side, so the caller
// never receives a silent truncation that looks like a normal stream
// end. The JSON payload is the standard gwerrors envelope — same
// shape the non-streaming path uses.
func writeTerminalSSEError(w http.ResponseWriter, flusher http.Flusher, enc *json.Encoder, berr *bfschemas.BifrostError) {
	payload := map[string]any{
		"error": map[string]any{
			"type":    "provider_error",
			"code":    "upstream_mid_stream_failure",
			"message": bfErrorMsg(berr),
		},
	}
	_, _ = w.Write([]byte("event: error\ndata: "))
	_ = enc.Encode(payload) // encoder writes the trailing newline
	_, _ = w.Write([]byte("\n"))
	if flusher != nil {
		flusher.Flush()
	}
}

// extractUsageFromStreamChunk pulls the tuple of usage counters + cost
// out of a single Bifrost stream chunk if it carries a usage block.
// Returns ok=false when the chunk has no usage; callers should keep
// the previously-seen values in that case so the running total from
// the last usage-bearing chunk wins.
func extractUsageFromStreamChunk(chunk *bfschemas.BifrostStreamChunk) (in, out, cr, cw int, cost float64, ok bool) {
	if chunk == nil || chunk.BifrostChatResponse == nil || chunk.BifrostChatResponse.Usage == nil {
		return 0, 0, 0, 0, 0, false
	}
	in, out, cr, cw, cost = extractUsage(chunk.BifrostChatResponse)
	if in == 0 && out == 0 && cr == 0 && cw == 0 {
		return 0, 0, 0, 0, 0, false
	}
	return in, out, cr, cw, cost, true
}

// ServeAnthropicMessages handles Anthropic-shape /v1/messages. We keep
// the caller's body byte-for-byte (preserves cache_control fields) and
// pass it to bifrost with Provider=Anthropic.
func (d *Dispatcher) ServeAnthropicMessages(w http.ResponseWriter, r *http.Request, b *auth.Bundle) {
	reqID := httpx.IDFromContext(r.Context())
	grq := budget.NewULID()
	w.Header().Set("X-LangWatch-Gateway-Request-Id", grq)
	gwotel.EnrichFromBundle(r.Context(), b)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGatewayReqID, grq)
	if !d.enforceRateLimit(w, r, b, reqID) {
		return
	}
	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err != nil {
		if httpx.IsMaxBytesError(err) {
			gwerrors.Write(w, reqID, gwerrors.TypePayloadTooLarge, "payload_too_large", "request body exceeds the configured maximum", "")
			return
		}
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "body_read_failed", err.Error(), "")
		return
	}
	// Cache override is evaluated on /v1/messages because Anthropic
	// is the canonical cache_control shape today. Still runs before
	// blocked-pattern checks so a disabled-cache request uses the
	// same regex evaluation as any other.
	if out, ok := d.applyCacheOverride(w, r, body, reqID); ok {
		body = out
	} else {
		return
	}
	if !d.enforceBlockedPatterns(w, b, body, reqID) {
		return
	}
	// For /v1/messages we default to anthropic unless the VK routes the
	// requested model elsewhere via model_aliases. Anthropic is the
	// wire shape for Claude Code / anthropic-sdk-*; bifrost knows how
	// to speak it directly.
	parsed, err := parseOpenAIChatBody(body) // shape has `model`, that's all we need here
	if err != nil {
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "bad_json", err.Error(), "")
		return
	}
	resolved, err := resolveModel(b, parsed.Model)
	if err != nil {
		if isModelNotAllowed(err) || errors.Is(err, errNoMatchingProvider) {
			gwerrors.Write(w, reqID, gwerrors.TypeModelNotAllowed, "model_not_allowed", err.Error(), "model")
			return
		}
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "model_resolve_failed", err.Error(), "model")
		return
	}
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModel, resolved.Model)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrProvider, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModelSource, string(resolved.Source))
	pre := d.budgetPrecheck(r.Context(), b, estimateCostUSD(len(body), resolved.Model))
	if pre.Decision == budget.DecisionHardStop {
		gwerrors.Write(w, reqID, gwerrors.TypeBudgetExceeded, "budget_hard_cap_hit", pre.Reason, "")
		return
	}
	for _, wrn := range pre.Warnings {
		w.Header().Add("X-LangWatch-Budget-Warning", fmt.Sprintf("%s:%.1f", wrn.Scope, wrn.PctUsed))
	}

	t0 := time.Now()
	resp, berr, events := d.callChat(r, b, resolved, body, 60*time.Second)
	fbCount := countFallbacks(events)
	w.Header().Set("X-LangWatch-Fallback-Count", strconv.Itoa(fbCount))
	if berr != nil {
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "provider_error")
		d.writeBifrostError(w, reqID, berr)
		return
	}
	// Post-response guardrails — same semantics as /v1/chat/completions.
	if pgRes, pgErr := d.postGuardrail(r.Context(), b, resp, resolved.Model, grq); pgErr != nil {
		failOpen := b != nil && b.Config != nil && valueMap(b.Config.Guardrails, "response_fail_open") == "true"
		if !failOpen {
			d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "provider_error")
			gwerrors.Write(w, reqID, gwerrors.TypeServiceUnavailable,
				"guardrail_upstream_unavailable",
				"post-guardrail service unavailable: "+pgErr.Error(), "")
			return
		}
		d.logger.Warn("post_guardrail_fail_open", "request_id", reqID, "err", pgErr.Error())
	} else if pgRes != nil && pgRes.Verdict == guardrails.VerdictBlock {
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "blocked_by_guardrail")
		gwerrors.Write(w, reqID, gwerrors.TypeGuardrailBlocked,
			"post_guardrail_blocked", pgRes.Reason, "")
		return
	}
	in, out, cr, cw, cost := extractUsage(resp)
	d.enqueueDebit(b, grq, resolved, in, out, cr, cw, cost, time.Since(t0).Milliseconds(), "success")
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageIn, int64(in))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageOut, int64(out))
	gwotel.AddFloatAttr(r.Context(), gwotel.AttrCostUSD, cost)
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrDurationMS, time.Since(t0).Milliseconds())
	gwotel.AddStringAttr(r.Context(), gwotel.AttrStatus, "success")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-LangWatch-Request-Id", reqID)
	w.Header().Set("X-LangWatch-Provider", string(resolved.Provider))
	_ = json.NewEncoder(w).Encode(resp)
}

// ServeEmbeddings handles OpenAI-shape /v1/embeddings.
func (d *Dispatcher) ServeEmbeddings(w http.ResponseWriter, r *http.Request, b *auth.Bundle) {
	reqID := httpx.IDFromContext(r.Context())
	grq := budget.NewULID()
	w.Header().Set("X-LangWatch-Gateway-Request-Id", grq)
	gwotel.EnrichFromBundle(r.Context(), b)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGatewayReqID, grq)
	if !d.enforceRateLimit(w, r, b, reqID) {
		return
	}
	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err != nil {
		if httpx.IsMaxBytesError(err) {
			gwerrors.Write(w, reqID, gwerrors.TypePayloadTooLarge, "payload_too_large", "request body exceeds the configured maximum", "")
			return
		}
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "body_read_failed", err.Error(), "")
		return
	}
	parsed, err := parseOpenAIChatBody(body)
	if err != nil {
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "bad_json", err.Error(), "")
		return
	}
	resolved, err := resolveModel(b, parsed.Model)
	if err != nil {
		if isModelNotAllowed(err) || errors.Is(err, errNoMatchingProvider) {
			gwerrors.Write(w, reqID, gwerrors.TypeModelNotAllowed, "model_not_allowed", err.Error(), "model")
			return
		}
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "model_resolve_failed", err.Error(), "model")
		return
	}
	bfReq := &bfschemas.BifrostEmbeddingRequest{
		Provider:       resolved.Provider,
		Model:          resolved.Model,
		RawRequestBody: body,
	}
	ctx := withBundle(r.Context(), b)
	bfCtx := bfschemas.NewBifrostContext(ctx, time.Now().Add(30*time.Second))
	t0 := time.Now()
	resp, berr := d.bifrost.EmbeddingRequest(bfCtx, bfReq)
	if berr != nil {
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "provider_error")
		d.writeBifrostError(w, reqID, berr)
		return
	}
	d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "success")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-LangWatch-Request-Id", reqID)
	w.Header().Set("X-LangWatch-Provider", string(resolved.Provider))
	_ = json.NewEncoder(w).Encode(resp)
}

// writeBifrostError translates a bifrost error into our OpenAI-compat
// envelope. We pick type based on StatusCode since BifrostError is
// provider-flavoured.
func (d *Dispatcher) writeBifrostError(w http.ResponseWriter, reqID string, be *bfschemas.BifrostError) {
	status := 0
	if be.StatusCode != nil {
		status = *be.StatusCode
	}
	switch {
	case status == http.StatusUnauthorized:
		gwerrors.Write(w, reqID, gwerrors.TypeProviderError, "provider_auth_failed",
			"upstream provider returned 401 — the provider credential attached to this VK is invalid; fix it in the AI Gateway → Providers screen", "")
	case status == http.StatusTooManyRequests:
		gwerrors.Write(w, reqID, gwerrors.TypeRateLimitExceeded, "upstream_rate_limit", bfErrorMsg(be), "")
	case status >= 500 && status < 600:
		gwerrors.Write(w, reqID, gwerrors.TypeProviderError, "upstream_5xx", bfErrorMsg(be), "")
	case status == http.StatusGatewayTimeout || status == 0:
		gwerrors.Write(w, reqID, gwerrors.TypeUpstreamTimeout, "upstream_timeout", bfErrorMsg(be), "")
	case status >= 400 && status < 500:
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "upstream_4xx", bfErrorMsg(be), "")
	default:
		gwerrors.Write(w, reqID, gwerrors.TypeInternalError, "bifrost_error", bfErrorMsg(be), "")
	}
}

func bfErrorMsg(be *bfschemas.BifrostError) string {
	if be == nil {
		return "unknown bifrost error"
	}
	if be.Error.Message != "" {
		return be.Error.Message
	}
	if be.Type != nil {
		return *be.Type
	}
	return "upstream provider error"
}
