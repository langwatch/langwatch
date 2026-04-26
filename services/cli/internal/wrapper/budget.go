package wrapper

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/services/cli/internal/config"
)

// BudgetStatusEndpoint is the path the wrapper hits before exec'ing a
// tool to find out whether the user has any budget left. Sergey's
// backend exposes the same shape the gateway 402 emits, so the CLI
// can render the branded message before the underlying tool ever
// makes a request.
//
// We deliberately keep this a single canonical path (not per-tool)
// because the budget is a property of the personal VK, not the tool.
const BudgetStatusEndpoint = "/api/auth/cli/budget/status"

// BudgetExceededError is returned when the gateway has flagged the
// user's personal budget as exhausted. Subcommands check for it,
// render a branded box, and exit 2 (configuration error) without
// exec'ing the underlying tool — per budget-exceeded.feature
// scenario "`langwatch claude` renders a clear budget message and
// exits non-zero."
type BudgetExceededError struct {
	Type               string `json:"type"`
	Scope              string `json:"scope"` // user | team | org | project
	LimitUSD           string `json:"limit_usd"`
	SpentUSD           string `json:"spent_usd"`
	Period             string `json:"period"` // month | week | day
	RequestIncreaseURL string `json:"request_increase_url"`
	AdminEmail         string `json:"admin_email"`
}

func (e *BudgetExceededError) Error() string {
	return fmt.Sprintf("%s budget exceeded: $%s of $%s spent this %s",
		e.Scope, e.SpentUSD, e.LimitUSD, e.Period)
}

// CheckBudget hits the gateway's budget-status endpoint with the
// user's bearer token and returns a *BudgetExceededError if the
// response indicates the user is currently blocked. Returns
// (nil, nil) for the happy path: budget OK or endpoint not yet
// implemented (404 — graceful fallback so old servers don't break
// the CLI).
//
// On any other error (network, bad JSON), returns a generic error
// the caller can decide to ignore or surface — the spec is explicit
// that non-budget 4xx should pass through to the underlying tool.
func CheckBudget(cfg *config.Config, httpc *http.Client) (*BudgetExceededError, error) {
	if !cfg.LoggedIn() {
		return nil, nil
	}
	if httpc == nil {
		httpc = http.DefaultClient
	}
	url := strings.TrimRight(cfg.ControlPlaneURL, "/") + BudgetStatusEndpoint
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := httpc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// budget-status endpoint returns 200 with { ok: true } when
		// nothing is exceeded; nothing to do.
		return nil, nil
	case http.StatusPaymentRequired:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var env struct {
			Error BudgetExceededError `json:"error"`
		}
		if err := json.Unmarshal(body, &env); err != nil {
			return nil, fmt.Errorf("decode budget 402: %w", err)
		}
		// We require at minimum a type+scope to render the branded
		// box. If the wire shape is malformed (older server, etc.)
		// fall through to a generic error rather than rendering a
		// half-empty box.
		if env.Error.Type == "" || env.Error.Scope == "" {
			return nil, fmt.Errorf("malformed budget_exceeded payload: %s", string(body))
		}
		return &env.Error, nil
	case http.StatusNotFound:
		// Older self-hosted server doesn't have the budget-status
		// endpoint yet. Skip the pre-check; the gateway will still
		// 402 if the request actually exceeds budget, and the
		// underlying tool will surface its own error.
		return nil, nil
	default:
		return nil, fmt.Errorf("unexpected budget status %d", resp.StatusCode)
	}
}

// RenderBudgetExceeded prints the spec-canonical Screen-8 box to the
// given writer. Format is exactly the lines budget-exceeded.feature
// scenario "`langwatch claude` renders a clear budget message and
// exits non-zero" pins down — character-for-character so spec
// regression tests can pin against fixtures.
//
// We render to plain ASCII (no colors / no box-drawing) when stdout
// is not a TTY, so piping `langwatch claude | tee log` doesn't
// litter the log with escape codes. The spec says "no ANSI noise
// into pipes."
func RenderBudgetExceeded(w io.Writer, e *BudgetExceededError) {
	period := e.Period
	if period == "" {
		period = "month"
	}
	fmt.Fprintf(w, "⚠  Budget limit reached\n")
	fmt.Fprintf(w, "\n")
	fmt.Fprintf(w, "   You've used $%s of your $%s %sly budget.\n",
		e.SpentUSD, e.LimitUSD, period)
	fmt.Fprintf(w, "   To continue, ask your team admin to raise your limit.\n")
	fmt.Fprintf(w, "\n")
	if e.AdminEmail != "" {
		fmt.Fprintf(w, "   Admin: %s\n\n", e.AdminEmail)
	}
	fmt.Fprintf(w, "   Need urgent access? Run:\n")
	fmt.Fprintf(w, "     langwatch request-increase\n")
}
