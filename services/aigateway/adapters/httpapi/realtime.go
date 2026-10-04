package httpapi

import (
	"bytes"
	"net/http"
	"strings"

	"github.com/bytedance/sonic"
	"github.com/go-chi/chi/v5"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// elevenLabsSingleUseTokenHandler terminates
// POST /v1/single-use-token/{token_type}, ElevenLabs' own token mint.
//
// The vendor's route names no model, so the mint reads model_id from the
// query string for the allowlist, the aliases and billing, and falls back to
// the default of the socket the token opens.
func elevenLabsSingleUseTokenHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		tokenType, ok := domain.ParseElevenLabsTokenType(chi.URLParam(r, "token_type"))
		if !ok {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"message": "unsupported token type: use tts_websocket, ttd_websocket, realtime_scribe or batch_scribe",
				"fault":   "customer",
			}))
			return
		}
		model := strings.TrimSpace(r.URL.Query().Get(domain.ElevenLabsModelField))
		if model == "" {
			model = tokenType.DefaultModel()
		}
		// Marshaled rather than concatenated: model_id is a raw query
		// parameter and every stage downstream parses this body.
		body, err := sonic.Marshal(map[string]string{
			"model":      model,
			"token_type": string(tokenType),
		})
		if err != nil {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrInternal, herr.M{
				"message": "could not build the session request body",
				"fault":   "gateway",
			}))
			return
		}

		result, err := deps.App.HandleRealtimeSession(r.Context(), bundle, app.RealtimeMintDispatch{
			Body:  body,
			Model: model,
			Session: domain.RealtimeSessionRequest{
				Vendor:    domain.RealtimeVendorElevenLabs,
				TokenType: tokenType,
			},
			Surface: domain.ElevenLabsSingleUseTokenSurface(),
		})
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		setMetaHeaders(w, result.Meta)
		writeJSONResponse(w, result.Response)
	}
}

// maxRealtimeCloseBodyBytes caps a close. It is empty or one number.
const maxRealtimeCloseBodyBytes = 4 << 10

// realtimeCloseHandler terminates
// POST /v1/realtime/sessions/{session_id}/close: the client says the call is
// over and has no usage left to report. What was reported already stands.
func realtimeCloseHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readFullBody(deps.Logger, w, r, maxRealtimeCloseBodyBytes)
		if !ok {
			return
		}
		if len(bytes.TrimSpace(body)) > 0 && !gjson.ParseBytes(body).IsObject() {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"message": `a close takes no body, or a JSON object such as {"duration_ms": 42000}`,
				"fault":   "customer",
			}))
			return
		}
		answer, err := deps.App.CloseRealtimeSession(r.Context(), bundle, app.RealtimeSessionClose{
			SessionID:  chi.URLParam(r, "session_id"),
			DurationMS: gjson.GetBytes(body, "duration_ms").Int(),
		})
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		writeRealtimeUsageAnswer(w, answer)
	}
}

// realtimeUsageBody is what a usage post or a close answers, in US dollars.
type realtimeUsageBody struct {
	SessionID      string              `json:"session_id"`
	Status         string              `json:"status"`
	CostUSD        float64             `json:"cost_usd"`
	SessionCostUSD float64             `json:"session_cost_usd"`
	Budget         realtimeBudgetState `json:"budget"`
}

// realtimeBudgetState tells a client whether to end the call: the gateway
// holds no socket, so the client is the only one that can.
type realtimeBudgetState struct {
	Exceeded bool   `json:"exceeded"`
	Scope    string `json:"scope,omitempty"`
	BudgetID string `json:"budget_id,omitempty"`
	Unknown  bool   `json:"unknown,omitempty"`
}

const nanoUSDPerUSD = 1e9

func writeRealtimeUsageAnswer(w http.ResponseWriter, answer app.RealtimeUsageAnswer) {
	body, err := sonic.Marshal(realtimeUsageBody{
		SessionID:      answer.SessionID,
		Status:         string(answer.Status),
		CostUSD:        float64(answer.CostNanoUSD) / nanoUSDPerUSD,
		SessionCostUSD: float64(answer.SessionCostNanoUSD) / nanoUSDPerUSD,
		Budget: realtimeBudgetState{
			Exceeded: answer.Budget.Exceeded,
			Scope:    answer.Budget.Scope,
			BudgetID: answer.Budget.BudgetID,
			Unknown:  answer.Budget.Unknown,
		},
	})
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
