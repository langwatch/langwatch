// Package rpc is the evaluators module's HTTP transport, mounted by nlpgo at
// /go/evaluators: bearer-guarded, decoded by pkg/rpc, langevals' wire.
package rpc

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
	httprpc "github.com/langwatch/langwatch/pkg/rpc"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// Header names the TS caller sends.
const (
	HeaderProjectID   = "X-LangWatch-Project-Id"
	HeaderTraceparent = "traceparent"
	HeaderTraceToken  = "X-LangWatch-Trace-Token"
)

// HandlerDeps are the transport's dependencies.
type HandlerDeps struct {
	API contract.EvaluatorRuntimeAPI
	// InternalSecret is NLPGO_INTERNAL_SECRET. Empty refuses every request.
	InternalSecret string
	// MaxBodyBytes caps an evaluation body.
	MaxBodyBytes int64
}

// evaluateBody is langevals' request body.
type evaluateBody struct {
	Data     []contract.Entry  `json:"data"`
	Settings json.RawMessage   `json:"settings"`
	Env      map[string]string `json:"env"`
}

// NewHandler routes the module's surface under /go/evaluators.
func NewHandler(deps HandlerDeps) http.Handler {
	contract.RegisterStatuses()
	httprpc.RegisterStatuses()

	mux := http.NewServeMux()
	mux.Handle("POST /go/evaluators/{family}/{evaluator}/evaluate",
		requireInternalSecret(deps.InternalSecret, evaluateHandler(deps.API, deps.MaxBodyBytes)))
	return mux
}

func evaluateHandler(api contract.EvaluatorRuntimeAPI, maxBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := httprpc.Decode[evaluateBody](w, r, maxBodyBytes)
		if herr.IsCode(err, httprpc.CodePayloadTooLarge) {
			err = herr.New(r.Context(), contract.ErrPayloadTooLarge, herr.M{"message": "evaluation payload too large"})
		}
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		results, err := api.Evaluate(r.Context(), contract.EvaluateRequest{
			Tenant:    contract.Tenant{ProjectID: r.Header.Get(HeaderProjectID), Env: body.Env},
			Evaluator: r.PathValue("family") + "/" + r.PathValue("evaluator"),
			Entries:   body.Data,
			Settings:  body.Settings,
			Trace: contract.TraceRequest{
				Traceparent: r.Header.Get(HeaderTraceparent),
				Token:       r.Header.Get(HeaderTraceToken),
			},
		})
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(results)
	}
}

// requireInternalSecret is langyagent's constant-time bearer check, except
// that an empty secret refuses everything instead of accepting "Bearer ".
func requireInternalSecret(secret string, next http.Handler) http.Handler {
	expected := []byte("Bearer " + secret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if secret == "" || subtle.ConstantTimeCompare(got, expected) != 1 {
			herr.WriteHTTP(w, herr.New(r.Context(), contract.ErrUnauthorized, herr.M{"message": "unauthorized"}))
			return
		}
		next.ServeHTTP(w, r)
	})
}
