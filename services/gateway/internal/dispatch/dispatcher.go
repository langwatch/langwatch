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
	"strings"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/blocked"
	"github.com/langwatch/langwatch/services/gateway/internal/cacheoverride"
	"github.com/langwatch/langwatch/services/gateway/internal/cacherules"
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

// applyCacheOverride resolves the effective cache-control mode for a
// request, honoring the documented precedence from contract §Precedence:
//
//	X-LangWatch-Cache header > matched cache rule > VK Cache default (respect)
//
// When a bundle-baked cache rule matches (internal/cacherules.Evaluate),
// the rule's mode is applied unless the caller sent an explicit header.
// Rule matches emit `langwatch.cache.rule_id` + `_priority` +
// `.mode_applied` span attrs and bump `gateway_cache_rule_hits_total`
// so operators can attribute cache behaviour per rule.
//
// Returns (body, true) when the dispatcher should continue; (nil, false)
// when we've already written a 400 envelope and the caller must return.
// Respect (default) + disable are implemented; force and ttl=N remain
// valid-but-deferred → 400.
func (d *Dispatcher) applyCacheOverride(w http.ResponseWriter, r *http.Request, body []byte, reqID string, b *auth.Bundle) ([]byte, bool) {
	hdr := r.Header.Get("X-LangWatch-Cache")

	// Header wins — no rule evaluation when the caller is explicit.
	if hdr != "" {
		return d.applyHeaderMode(w, r, body, reqID, hdr)
	}

	// No header → consider bundle-baked rules (iter 45 evaluator).
	if b != nil && b.Config != nil && len(b.Config.CacheRules) > 0 {
		match, ok := cacherules.Evaluate(b.Config.CacheRules, cacherules.Request{
			VKID:        b.DisplayPrefix,
			PrincipalID: b.JWTClaims.PrincipalID,
			Model:       extractModelField(body),
			// vk_tags + request_metadata aren't yet plumbed through the
			// hot path; they'll land when the bundle/request pipeline
			// carries them. Evaluate tolerates zero-value fields.
		})
		if ok {
			return d.applyRuleMode(w, r, body, reqID, b, &match)
		}
	}

	// Fall through: no header, no rule match → respect VK default (no-op
	// body transform since cacheoverride.Apply on Kind=respect is pass-through).
	return body, true
}

// extractModelField cheaply pulls the top-level `model` field from a
// JSON body so cache-rule model matchers can fire without requiring
// callers to parse the full body first. Returns "" on any decode
// error — Evaluate treats empty as wildcard, so the rule-eval path
// degrades gracefully to VK/principal/tag-only matching.
//
// Tradeoff: this is a cheap shape-peek (unmarshal into a single-field
// struct), not a reuse of parseOpenAIChatBody, because we want zero
// allocations on the non-matching path. ~150 ns for a typical body.
func extractModelField(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var peek struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(body, &peek)
	return peek.Model
}

// applyHeaderMode handles the X-LangWatch-Cache request header path.
// Preserves v1 semantics: respect/disable implemented, force/ttl=N
// return 400 with `cache_override_not_implemented`.
func (d *Dispatcher) applyHeaderMode(w http.ResponseWriter, r *http.Request, body []byte, reqID, hdr string) ([]byte, bool) {
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
	gwotel.AddStringAttr(r.Context(), gwotel.AttrCacheModeApplied, string(mode.Kind))
	return out, true
}

// applyRuleMode handles the matched-rule path. Supports rule.Mode in
// {respect, disable, force}; Anthropic-shape force injects
// cache_control: ephemeral on system[-1] + messages[-1].content[-1]
// per spec §3. OpenAI-shape force is a body-level no-op (their
// caching is automatic). Gemini force isn't implemented in v1 because
// it needs a /cachedContents pre-POST that breaks zero-hop.
func (d *Dispatcher) applyRuleMode(w http.ResponseWriter, r *http.Request, body []byte, reqID string, b *auth.Bundle, match *cacherules.Match) ([]byte, bool) {
	mode := cacheoverride.Mode{Kind: cacheoverride.Kind(match.Mode), TTLSecs: match.TTLS}
	out, err := cacheoverride.Apply(mode, body)
	if err != nil {
		if errors.Is(err, cacheoverride.ErrNotImplemented) {
			// ttl=N on a rule today; spec'd but deferred.
			d.logger.Warn("cache_rule_mode_not_implemented",
				"rule_id", match.RuleID, "vk_id", b.DisplayPrefix, "mode", match.Mode)
			// Fall back to passthrough so the request succeeds.
			out = body
		} else {
			gwerrors.Write(w, reqID, gwerrors.TypeCacheOverrideInvalid,
				"cache_override_apply_failed", err.Error(), "cache_rule")
			return nil, false
		}
	}
	w.Header().Set("X-LangWatch-Cache-Mode", match.Mode)
	// Observability: rule attribution on the span + metric bump.
	gwotel.AddStringAttr(r.Context(), gwotel.AttrCacheRuleID, match.RuleID)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrCacheModeApplied, match.Mode)
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrCacheRulePriority, int64(match.Priority))
	d.metrics.RecordCacheRuleHit(match.RuleID, strings.ToUpper(match.Mode))
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
			// Bifrost's ChatCompletionRequest rejects req.Input == nil
			// even when we've set BifrostContextKeyUseRawRequestBody.
			// Stub a non-nil empty slice so the check passes; provider
			// implementations honour the raw-body context key and
			// ignore Input entirely. See bifrost.go:679.
			Input: []bfschemas.ChatMessage{},
		}
		dispatchCtx := context.WithValue(
			withBundle(withCredentialPin(ctx, credID), b),
			bfschemas.BifrostContextKeyUseRawRequestBody, true,
		)
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
			// Bifrost's ChatCompletionRequest rejects req.Input == nil
			// even when we've set BifrostContextKeyUseRawRequestBody.
			// Stub a non-nil empty slice so the check passes; provider
			// implementations honour the raw-body context key and
			// ignore Input entirely. See bifrost.go:679.
			Input: []bfschemas.ChatMessage{},
		}
		// We send RawRequestBody (client's exact JSON) and never
		// materialize Input{} — Bifrost refuses to dispatch unless
		// this context key tells it to use the raw body instead.
		dispatchCtx := context.WithValue(
			withBundle(withCredentialPin(ctx, credID), b),
			bfschemas.BifrostContextKeyUseRawRequestBody, true,
		)
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
	gwotel.EnrichFromRequestHeaders(r.Context(), r)
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
	// Cache override is evaluated on /v1/chat/completions too — OpenAI
	// doesn't carry cache_control in the wire body (their prompt caching
	// is automatic), so mode=disable is a no-op on this path. Rule
	// matches still fire span attrs + metric so operators get rule-
	// attribution on both endpoints. mode=force downgrades to respect
	// with a WARN (v1 scope). Model matchers work via extractModelField.
	if out, ok := d.applyCacheOverride(w, r, body, reqID, b); ok {
		body = out
	} else {
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
	// Rewrite the body's model field to the provider-native name so Bifrost's
	// RawRequestBody passthrough sends "gpt-5-mini" upstream instead of
	// "openai/gpt-5-mini". Applies for alias/explicit_slash sources where
	// the bare name differs from the request's model string.
	body = rewriteRequestModel(body, parsed.Model, resolved.Model)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModel, resolved.Model)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIOperationName, "chat")
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIRequestModel, resolved.Model)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAISystem, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrProvider, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModelSource, string(resolved.Source))
	gwotel.AddBoolAttr(r.Context(), gwotel.AttrStreaming, parsed.Stream)
	stampGenAIRequestParams(r.Context(), parsed)
	// Payload capture: stamp the request messages as
	// gen_ai.input.messages so the trace pipeline hoists them into
	// the trace's Input column. ADR-017 v1 scope — gated only by
	// payload length (see capacity clamp in AddStringAttr-callers).
	if len(parsed.Messages) > 0 {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIInputMessages, string(parsed.Messages))
	}
	// Hoist system prompts into gen_ai.system_instructions so the
	// trace renderer finds them regardless of transport:
	//   - Anthropic /v1/messages: top-level `system` field (parsed.System)
	//   - OpenAI /v1/chat/completions: role=system entry inside messages
	// Rendering convention is the same on both paths — ariana's #75/#76.
	if sysInstr := resolveSystemInstructions(parsed); sysInstr != "" {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAISystemInstructions, sysInstr)
	}

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
	stampFallbackAttribution(r.Context(), events, b)
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
	if total := in + out; total > 0 {
		gwotel.AddInt64Attr(r.Context(), gwotel.AttrGenAIUsageTotalTokens, int64(total))
	}
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheReadInputTokens, int64(cr))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheCreationInputTokens, int64(cw))
	gwotel.AddFloatAttr(r.Context(), gwotel.AttrCostUSD, cost)
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrDurationMS, time.Since(t0).Milliseconds())
	gwotel.AddStringAttr(r.Context(), gwotel.AttrStatus, "success")
	if outMsgs := extractOutputMessages(resp); outMsgs != "" {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIOutputMessages, outMsgs)
	}
	stampGenAIResponseMeta(r.Context(), resp)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-LangWatch-Provider", string(resolved.Provider))
	w.Header().Set("X-LangWatch-Model", resolved.Model)
	_ = json.NewEncoder(w).Encode(resp)
	d.metrics.ObserveHTTPRequest("/v1/chat/completions", "success", string(resolved.Provider), resolved.Model, time.Since(t0).Seconds())
}

// stampFallbackAttribution emits the §6 attribution attributes on the
// active span: total attempts, winning-slot provider + credential.
// Safe on empty events (gateway skipped the chain entirely).
func stampFallbackAttribution(ctx context.Context, events []fallback.Event, b *auth.Bundle) {
	if len(events) == 0 {
		return
	}
	gwotel.AddInt64Attr(ctx, gwotel.AttrFallbackAttemptsCount, int64(len(events)))

	last := events[len(events)-1]
	if last.Reason != fallback.ReasonPrimarySuccess && last.Reason != fallback.ReasonFallbackSuccess {
		return
	}
	if last.Credential != "" {
		gwotel.AddStringAttr(ctx, gwotel.AttrFallbackWinningCredential, last.Credential)
	}
	if prov := lookupProviderForCredential(b, last.Credential); prov != "" {
		gwotel.AddStringAttr(ctx, gwotel.AttrFallbackWinningProvider, prov)
	}
}

// lookupProviderForCredential returns the bound provider type (e.g.
// "openai", "anthropic") for a given provider-credential ID from the
// VK config, or "" when no match or no config.
func lookupProviderForCredential(b *auth.Bundle, credID string) string {
	if b == nil || b.Config == nil || credID == "" {
		return ""
	}
	for _, pc := range b.Config.ProviderCreds {
		if pc.ID == credID {
			return pc.Type
		}
	}
	return ""
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
	stampFallbackAttribution(r.Context(), events, b)
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
		// Streaming output accumulation for gen_ai.output.messages
		// + gen_ai.response.* attrs. We mirror the non-streaming
		// path's span shape so gateway spans stay interchangeable
		// regardless of transport (rchaves "EVERYTHING follows
		// gen_ai specs").
		streamContent      strings.Builder
		streamFinishReason string
		streamResponseID   string
		streamResponseModel string
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
		if delta := extractChunkDeltaText(chunk); delta != "" {
			streamContent.WriteString(delta)
		}
		if chunk.BifrostChatResponse != nil {
			if chunk.BifrostChatResponse.ID != "" && streamResponseID == "" {
				streamResponseID = chunk.BifrostChatResponse.ID
			}
			if chunk.BifrostChatResponse.Model != "" {
				streamResponseModel = chunk.BifrostChatResponse.Model
			}
			if len(chunk.BifrostChatResponse.Choices) > 0 {
				if fr := chunk.BifrostChatResponse.Choices[0].FinishReason; fr != nil && *fr != "" {
					streamFinishReason = *fr
				}
			}
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
	if total := lastIn + lastOut; total > 0 {
		gwotel.AddInt64Attr(r.Context(), gwotel.AttrGenAIUsageTotalTokens, int64(total))
	}
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheReadInputTokens, int64(lastCR))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheCreationInputTokens, int64(lastCW))
	gwotel.AddFloatAttr(r.Context(), gwotel.AttrCostUSD, lastCost)
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrDurationMS, duration)
	// Stamp streaming-reassembled response metadata + output content
	// on the span at close. Matches the non-streaming path so gateway
	// traces are transport-agnostic.
	if streamResponseID != "" {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIResponseID, streamResponseID)
	}
	if streamResponseModel != "" {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIResponseModel, streamResponseModel)
	}
	if streamFinishReason != "" {
		if js, err := json.Marshal([]string{streamFinishReason}); err == nil {
			gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIResponseFinishReasons, string(js))
		}
	}
	if streamContent.Len() > 0 {
		outMsg := []map[string]any{{
			"role":          "assistant",
			"content":       streamContent.String(),
			"finish_reason": streamFinishReason,
		}}
		if js, err := json.Marshal(outMsg); err == nil {
			gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIOutputMessages, string(js))
		}
	}
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
// Bifrost normalises cached-token accounting across providers:
//
//   - Anthropic: cache_read_input_tokens → CachedReadTokens,
//     cache_creation_input_tokens → CachedWriteTokens (providers/anthropic)
//   - OpenAI: cached_tokens → CachedReadTokens (no write; their cache is
//     automatic & billed at 50% discount on read only)
//   - Azure OpenAI: inherits OpenAI mapping
//   - Gemini: cached_content_token_count → CachedReadTokens
//   - Bedrock: inherits the underlying provider's cache semantics
//
// PromptTokens already INCLUDES CachedReadTokens + CachedWriteTokens on the
// Bifrost normalised path (see providers/anthropic/anthropic.go:952), so
// downstream cost calculation in the control plane must NOT add them again.
//
// Cost is intentionally left 0 — control-plane recomputes from tokens
// using its pricing catalog.
func extractUsage(resp *bfschemas.BifrostChatResponse) (in, out, cr, cw int, cost float64) {
	if resp == nil || resp.Usage == nil {
		return
	}
	in = resp.Usage.PromptTokens
	out = resp.Usage.CompletionTokens
	if d := resp.Usage.PromptTokensDetails; d != nil {
		cr = d.CachedReadTokens
		cw = d.CachedWriteTokens
	}
	return
}

// stampGenAIRequestParams stamps the OTel gen_ai.request.* attributes
// from the parsed body. Each field is emitted only when the client
// actually set it — we never coerce defaults, so the span reflects the
// wire request verbatim. Keeps gateway traces interchangeable with
// SDK-instrumented client traces for the same semconv surface.
func stampGenAIRequestParams(ctx context.Context, parsed openaiChatRequest) {
	if parsed.Temperature != nil {
		gwotel.AddFloatAttr(ctx, gwotel.AttrGenAIRequestTemperature, *parsed.Temperature)
	}
	if parsed.TopP != nil {
		gwotel.AddFloatAttr(ctx, gwotel.AttrGenAIRequestTopP, *parsed.TopP)
	}
	if parsed.FrequencyPenalty != nil {
		gwotel.AddFloatAttr(ctx, gwotel.AttrGenAIRequestFreqPenalty, *parsed.FrequencyPenalty)
	}
	if parsed.PresencePenalty != nil {
		gwotel.AddFloatAttr(ctx, gwotel.AttrGenAIRequestPresPenalty, *parsed.PresencePenalty)
	}
	// OpenAI's current spec prefers max_completion_tokens; older
	// clients send max_tokens. We expose whichever the caller used.
	if parsed.MaxCompletion != nil {
		gwotel.AddInt64Attr(ctx, gwotel.AttrGenAIRequestMaxTokens, *parsed.MaxCompletion)
	} else if parsed.MaxTokens != nil {
		gwotel.AddInt64Attr(ctx, gwotel.AttrGenAIRequestMaxTokens, *parsed.MaxTokens)
	}
	if stop := joinStopField(parsed); stop != "" {
		gwotel.AddStringAttr(ctx, gwotel.AttrGenAIRequestStopSeqs, stop)
	}
}

// joinStopField normalises OpenAI-style `stop` (string | string[]) and
// Anthropic `stop_sequences` (string[]) into a single JSON-encoded
// array string so the attribute is always parseable downstream.
// Returns "" when neither field is set.
func joinStopField(parsed openaiChatRequest) string {
	if len(parsed.Stop) > 0 && string(parsed.Stop) != "null" {
		return string(parsed.Stop)
	}
	if len(parsed.StopSequences) > 0 && string(parsed.StopSequences) != "null" {
		return string(parsed.StopSequences)
	}
	return ""
}

// stampGenAIResponseMeta stamps the OTel gen_ai.response.* attributes
// (id, model, finish_reasons) from the upstream response. Each value
// is emitted only when present on the payload — omissions are
// reflected in the span so downstream consumers don't confuse
// "upstream didn't return X" with "X was empty".
func stampGenAIResponseMeta(ctx context.Context, resp *bfschemas.BifrostChatResponse) {
	if resp == nil {
		return
	}
	if resp.ID != "" {
		gwotel.AddStringAttr(ctx, gwotel.AttrGenAIResponseID, resp.ID)
	}
	if resp.Model != "" {
		gwotel.AddStringAttr(ctx, gwotel.AttrGenAIResponseModel, resp.Model)
	}
	if reasons := collectFinishReasons(resp); reasons != "" {
		gwotel.AddStringAttr(ctx, gwotel.AttrGenAIResponseFinishReasons, reasons)
	}
}

// collectFinishReasons returns a JSON-encoded array of the finish
// reason from every choice — matches the OTel semconv contract (the
// canonicaliser parses a JSON string array back into the
// `gen_ai.response.finish_reasons` column).
func collectFinishReasons(resp *bfschemas.BifrostChatResponse) string {
	if resp == nil || len(resp.Choices) == 0 {
		return ""
	}
	reasons := make([]string, 0, len(resp.Choices))
	for _, ch := range resp.Choices {
		if ch.FinishReason == nil || *ch.FinishReason == "" {
			continue
		}
		reasons = append(reasons, *ch.FinishReason)
	}
	if len(reasons) == 0 {
		return ""
	}
	b, err := json.Marshal(reasons)
	if err != nil {
		return ""
	}
	return string(b)
}

// resolveSystemInstructions picks the system prompts for the span
// attribute, preferring Anthropic's top-level `system` field when set
// and otherwise hoisting role=system entries from the messages array.
// Returns "" when neither source carries a system message.
func resolveSystemInstructions(parsed openaiChatRequest) string {
	if len(parsed.System) > 0 && string(parsed.System) != "null" {
		return string(parsed.System)
	}
	return extractSystemInstructionsFromMessages(parsed.Messages)
}

// extractSystemInstructionsFromMessages scans an OpenAI-style messages
// array for entries with role=system and returns the JSON-encoded list
// of their content strings. Lets the gateway hoist system prompts into
// `gen_ai.system_instructions` uniformly, independent of whether the
// caller used Anthropic's top-level `system` field or OpenAI's
// role=system message entries. Empty string when no system entries
// are present.
//
// Matches the canonicaliser's treatment: system_instructions is a
// separate renderer column, so the trace UI shows it inline with the
// INPUT section instead of leaving it invisible in the messages list.
func extractSystemInstructionsFromMessages(messages json.RawMessage) string {
	if len(messages) == 0 {
		return ""
	}
	var raw []map[string]json.RawMessage
	if err := json.Unmarshal(messages, &raw); err != nil {
		return ""
	}
	out := make([]map[string]any, 0, 1)
	for _, m := range raw {
		var role string
		if err := json.Unmarshal(m["role"], &role); err != nil || role != "system" {
			continue
		}
		if content, ok := m["content"]; ok && len(content) > 0 {
			var s string
			if err := json.Unmarshal(content, &s); err == nil && s != "" {
				out = append(out, map[string]any{"role": "system", "content": s})
				continue
			}
			out = append(out, map[string]any{"role": "system", "content": json.RawMessage(content)})
		}
	}
	if len(out) == 0 {
		return ""
	}
	b, err := json.Marshal(out)
	if err != nil {
		return ""
	}
	return string(b)
}

// extractOutputMessages marshals response choices into the
// gen_ai.output.messages attribute payload. Returns "" when nothing
// was captured (no choices / marshal failure) so the caller skips
// stamping rather than emitting noise.
//
// Shape is compatible with the LangWatch canonicaliser's
// chat_messages extraction (see genAi.ts extractor rules §214-223):
// each entry is a JSON object with {role, content}.
func extractOutputMessages(resp *bfschemas.BifrostChatResponse) string {
	if resp == nil || len(resp.Choices) == 0 {
		return ""
	}
	type outMsg struct {
		Role         string `json:"role"`
		Content      string `json:"content,omitempty"`
		FinishReason string `json:"finish_reason,omitempty"`
	}
	msgs := make([]outMsg, 0, len(resp.Choices))
	for _, ch := range resp.Choices {
		if ch.ChatNonStreamResponseChoice == nil || ch.ChatNonStreamResponseChoice.Message == nil {
			continue
		}
		m := ch.ChatNonStreamResponseChoice.Message
		content := ""
		if m.Content != nil && m.Content.ContentStr != nil {
			content = *m.Content.ContentStr
		}
		finish := ""
		if ch.FinishReason != nil {
			finish = *ch.FinishReason
		}
		msgs = append(msgs, outMsg{Role: string(m.Role), Content: content, FinishReason: finish})
	}
	if len(msgs) == 0 {
		return ""
	}
	b, err := json.Marshal(msgs)
	if err != nil {
		return ""
	}
	return string(b)
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
	gwotel.EnrichFromRequestHeaders(r.Context(), r)
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
	// same regex evaluation as any other. applyCacheOverride uses
	// extractModelField() on the body so rule.matchers.model fires
	// without waiting on the downstream parseOpenAIChatBody.
	if out, ok := d.applyCacheOverride(w, r, body, reqID, b); ok {
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
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIOperationName, "messages")
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIRequestModel, resolved.Model)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAISystem, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrProvider, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModelSource, string(resolved.Source))
	stampGenAIRequestParams(r.Context(), parsed)
	if len(parsed.Messages) > 0 {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIInputMessages, string(parsed.Messages))
	}
	if sysInstr := resolveSystemInstructions(parsed); sysInstr != "" {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAISystemInstructions, sysInstr)
	}
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
	gwotel.AddInt64Attr(r.Context(), "langwatch.fallback.attempts", int64(len(events)))
	gwotel.AddInt64Attr(r.Context(), "langwatch.fallback.count", int64(fbCount))
	stampFallbackAttribution(r.Context(), events, b)
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
	if total := in + out; total > 0 {
		gwotel.AddInt64Attr(r.Context(), gwotel.AttrGenAIUsageTotalTokens, int64(total))
	}
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheReadInputTokens, int64(cr))
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageCacheCreationInputTokens, int64(cw))
	gwotel.AddFloatAttr(r.Context(), gwotel.AttrCostUSD, cost)
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrDurationMS, time.Since(t0).Milliseconds())
	gwotel.AddStringAttr(r.Context(), gwotel.AttrStatus, "success")
	if outMsgs := extractOutputMessages(resp); outMsgs != "" {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIOutputMessages, outMsgs)
	}
	stampGenAIResponseMeta(r.Context(), resp)
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
	gwotel.EnrichFromRequestHeaders(r.Context(), r)
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
	// Cache override on /v1/embeddings — all 5 providers' embedding
	// APIs cache input tokens transparently (OpenAI 50% discount,
	// Azure inherits, others similar), so mode=disable/force are
	// body-level no-ops here. Rule matches still emit span attrs +
	// bump the metric for per-rule attribution on the embedding path.
	if out, ok := d.applyCacheOverride(w, r, body, reqID, b); ok {
		body = out
	} else {
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
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIOperationName, "embeddings")
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIRequestModel, resolved.Model)
	gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAISystem, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrProvider, string(resolved.Provider))
	gwotel.AddStringAttr(r.Context(), gwotel.AttrModelSource, string(resolved.Source))
	// Bifrost v1.4.22 validates `req.Input == nil || all-nested-nil` on
	// embedding requests BEFORE honouring the raw-body passthrough flag
	// (core/bifrost.go:922). Stub a non-nil Input with empty text so
	// the validator passes and providers fall through to the raw-body
	// OpenAI-wire path. Mirrors the chat-path stub shipped in iter 61.
	emptyText := ""
	bfReq := &bfschemas.BifrostEmbeddingRequest{
		Provider:       resolved.Provider,
		Model:          resolved.Model,
		RawRequestBody: body,
		Input:          &bfschemas.EmbeddingInput{Text: &emptyText},
	}
	ctx := context.WithValue(
		withBundle(r.Context(), b),
		bfschemas.BifrostContextKeyUseRawRequestBody, true,
	)
	bfCtx := bfschemas.NewBifrostContext(ctx, time.Now().Add(30*time.Second))
	t0 := time.Now()
	resp, berr := d.bifrost.EmbeddingRequest(bfCtx, bfReq)
	if berr != nil {
		d.enqueueDebit(b, grq, resolved, 0, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "provider_error")
		d.writeBifrostError(w, reqID, berr)
		return
	}
	in, _ := extractEmbeddingUsage(resp)
	d.enqueueDebit(b, grq, resolved, in, 0, 0, 0, 0, time.Since(t0).Milliseconds(), "success")
	if in > 0 {
		gwotel.AddInt64Attr(r.Context(), gwotel.AttrUsageIn, int64(in))
		gwotel.AddInt64Attr(r.Context(), gwotel.AttrGenAIUsageTotalTokens, int64(in))
	}
	gwotel.AddInt64Attr(r.Context(), gwotel.AttrDurationMS, time.Since(t0).Milliseconds())
	gwotel.AddStringAttr(r.Context(), gwotel.AttrStatus, "success")
	if resp != nil && resp.Model != "" {
		gwotel.AddStringAttr(r.Context(), gwotel.AttrGenAIResponseModel, resp.Model)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-LangWatch-Request-Id", reqID)
	w.Header().Set("X-LangWatch-Provider", string(resolved.Provider))
	_ = json.NewEncoder(w).Encode(resp)
}

// extractEmbeddingUsage pulls the prompt token count off a Bifrost
// embedding response. Embeddings only have input tokens — no
// generation side — so we return a single (in, ok) pair. Falls back
// to 0 when Usage is absent, matching the #74 contract "no usage →
// omit, don't zero".
func extractEmbeddingUsage(resp *bfschemas.BifrostEmbeddingResponse) (int, bool) {
	if resp == nil || resp.Usage == nil {
		return 0, false
	}
	return resp.Usage.PromptTokens, true
}

// writeBifrostError translates a bifrost error into our OpenAI-compat
// envelope. We pick type based on StatusCode since BifrostError is
// provider-flavoured.
func (d *Dispatcher) writeBifrostError(w http.ResponseWriter, reqID string, be *bfschemas.BifrostError) {
	d.writeBifrostErrorWithModel(w, reqID, be, "")
}

// writeBifrostErrorWithModel is the model-aware variant used by
// dispatch paths that have a resolved model in scope. It exists so
// compat-rejection observability (openai-param-compat.feature §v1
// observability) can label the metric with the target model without
// changing every existing callsite.
func (d *Dispatcher) writeBifrostErrorWithModel(w http.ResponseWriter, reqID string, be *bfschemas.BifrostError, model string) {
	status := 0
	if be.StatusCode != nil {
		status = *be.StatusCode
	}
	msg := bfErrorMsg(be)
	if status >= 400 && status < 500 && d.metrics != nil {
		if reason := classifyCompatRejection(msg); reason != "" {
			d.metrics.RecordUpstreamCompatRejected(reason, model)
		}
	}
	switch {
	case status == http.StatusUnauthorized:
		gwerrors.Write(w, reqID, gwerrors.TypeProviderError, "provider_auth_failed",
			"upstream provider returned 401 — the provider credential attached to this VK is invalid; fix it in the AI Gateway → Providers screen", "")
	case status == http.StatusTooManyRequests:
		gwerrors.Write(w, reqID, gwerrors.TypeRateLimitExceeded, "upstream_rate_limit", msg, "")
	case status >= 500 && status < 600:
		gwerrors.Write(w, reqID, gwerrors.TypeProviderError, "upstream_5xx", msg, "")
	case status == http.StatusGatewayTimeout || status == 0:
		gwerrors.Write(w, reqID, gwerrors.TypeUpstreamTimeout, "upstream_timeout", msg, "")
	case status >= 400 && status < 500:
		gwerrors.Write(w, reqID, gwerrors.TypeBadRequest, "upstream_4xx", msg, "")
	default:
		gwerrors.Write(w, reqID, gwerrors.TypeInternalError, "bifrost_error", msg, "")
	}
}

// classifyCompatRejection inspects an upstream 4xx error message for
// known client-library / parameter-shape incompatibilities. Returns
// the reason bucket, or "" when the error isn't a recognised compat
// mismatch.
func classifyCompatRejection(msg string) string {
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "max_tokens") && strings.Contains(lower, "max_completion_tokens") {
		return "legacy_max_tokens"
	}
	return ""
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
