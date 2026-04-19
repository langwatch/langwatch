package budget

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// Checker makes a live `POST /api/internal/gateway/budget/check` call
// for the subset of budget scopes that are hot (within NearLimitPct of
// their hard limit). The cached precheck is correct most of the time;
// the live call closes the stale-snapshot race for scopes on the edge
// where a debit from a concurrent gateway node could have tipped the
// balance since the last config refresh.
//
// Fail-open: on transport error / timeout / 5xx the caller falls back
// to cached precheck. The only failure path that blocks the user is
// the explicit live-budget hard cap (spent + estimate > limit).
type Checker struct {
	endpoint string
	http     *http.Client
	sign     Signer
	logger   *slog.Logger
	pct      float64 // fraction of hard limit considered "near"; default 0.9 = 90%
	timeout  time.Duration
}

type CheckerOptions struct {
	ControlPlaneBaseURL string
	Sign                Signer
	Logger              *slog.Logger
	// NearLimitPct is the cached spent/limit ratio above which the live
	// call fires. 0 means default (0.9 = 90%). Values over 1 disable
	// the optimisation (every request calls /check).
	NearLimitPct float64
	// Timeout bounds the live call. 0 = 200ms default.
	Timeout time.Duration
}

// NewChecker builds a budget live-check client.
func NewChecker(opts CheckerOptions) *Checker {
	if opts.NearLimitPct == 0 {
		opts.NearLimitPct = 0.9
	}
	if opts.Timeout == 0 {
		opts.Timeout = 200 * time.Millisecond
	}
	return &Checker{
		endpoint: opts.ControlPlaneBaseURL + "/api/internal/gateway/budget/check",
		http:     &http.Client{Timeout: opts.Timeout},
		sign:     opts.Sign,
		logger:   opts.Logger,
		pct:      opts.NearLimitPct,
		timeout:  opts.Timeout,
	}
}

// checkRequest matches contract §4.4.
type checkRequest struct {
	VirtualKeyID string       `json:"vk_id"`
	Scopes       []checkScope `json:"scopes"`
}

type checkScope struct {
	Scope   string `json:"scope"`
	ScopeID string `json:"scope_id"`
	Window  string `json:"window"`
}

type checkResponse struct {
	Scopes []ScopeLive `json:"scopes"`
}

// ScopeLive is the per-scope live reading the control plane returns.
type ScopeLive struct {
	Scope    string  `json:"scope"`
	ScopeID  string  `json:"scope_id"`
	Window   string  `json:"window"`
	SpentUSD float64 `json:"spent_usd"`
	LimitUSD float64 `json:"limit_usd"`
}

// HotScopes returns the VK's budget scopes whose cached spent_usd is
// >= NearLimitPct * limit. These are the ones that need live
// reconciliation. Returns nil when no scope is near.
func (c *Checker) HotScopes(b *auth.Bundle) []auth.BudgetSpec {
	if b == nil || b.Config == nil {
		return nil
	}
	var hot []auth.BudgetSpec
	for _, s := range b.Config.Budgets {
		if s.LimitUSD <= 0 {
			continue
		}
		if s.SpentUSD/s.LimitUSD >= c.pct {
			hot = append(hot, s)
		}
	}
	return hot
}

// CheckLive calls the control plane for fresh spent_usd on the given
// scopes. Returns a result-by-scope-key map. On any error the caller
// should fall back to cached values.
func (c *Checker) CheckLive(ctx context.Context, b *auth.Bundle, scopes []auth.BudgetSpec) (map[string]ScopeLive, error) {
	if c == nil || len(scopes) == 0 {
		return nil, nil
	}
	payload := checkRequest{
		VirtualKeyID: b.JWTClaims.VirtualKeyID,
		Scopes:       make([]checkScope, 0, len(scopes)),
	}
	for _, s := range scopes {
		payload.Scopes = append(payload.Scopes, checkScope{
			Scope: s.Scope, ScopeID: s.ScopeID, Window: s.Window,
		})
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, "POST", c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.sign != nil {
		c.sign(req, body)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("budget/check transport: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("budget/check upstream %d: %s", resp.StatusCode, string(b))
	}
	var decoded checkResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("budget/check decode: %w", err)
	}
	out := make(map[string]ScopeLive, len(decoded.Scopes))
	for _, s := range decoded.Scopes {
		out[scopeKey(s.Scope, s.ScopeID, s.Window)] = s
	}
	return out, nil
}

// ApplyLive returns a new precheck decision computed after
// substituting the live spent_usd values for the scopes supplied.
// Scopes not in `live` fall back to their cached value. A scope that
// breaches after reconciliation forces a DecisionHardStop.
func ApplyLive(b *auth.Bundle, estimatedCostUSD float64, live map[string]ScopeLive) PrecheckResult {
	if b == nil || b.Config == nil {
		return PrecheckResult{Decision: DecisionAllow}
	}
	var warnings []Warning
	hardBlock := ""
	for _, s := range b.Config.Budgets {
		spent := s.SpentUSD
		limit := s.LimitUSD
		if v, ok := live[scopeKey(s.Scope, s.ScopeID, s.Window)]; ok {
			spent = v.SpentUSD
			if v.LimitUSD > 0 {
				limit = v.LimitUSD
			}
		}
		remaining := limit - spent
		projRemaining := remaining - estimatedCostUSD
		pctUsed := 0.0
		if limit > 0 {
			pctUsed = (spent / limit) * 100
		}
		switch s.OnBreach {
		case "block":
			if projRemaining < 0 {
				hardBlock = fmt.Sprintf("budget exceeded scope=%s window=%s remaining=%.4f required~=%.4f (live)",
					s.Scope, s.Window, remaining, estimatedCostUSD)
			}
		case "warn":
			if projRemaining < 0 || pctUsed >= 90 {
				warnings = append(warnings, Warning{Scope: s.Scope, PctUsed: pctUsed})
			}
		}
	}
	if hardBlock != "" {
		return PrecheckResult{Decision: DecisionHardStop, Reason: hardBlock, Warnings: warnings}
	}
	if len(warnings) > 0 {
		return PrecheckResult{Decision: DecisionSoftWarn, Warnings: warnings}
	}
	return PrecheckResult{Decision: DecisionAllow}
}

func scopeKey(scope, scopeID, window string) string {
	return scope + "|" + scopeID + "|" + window
}
