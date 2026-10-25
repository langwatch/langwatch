// Package rpc is the evaluators module's HTTP transport, mounted by nlpgo at
// /go/evaluators: bearer-guarded, decoded by pkg/rpc, langevals' wire.
package rpc

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"

	"go.uber.org/zap"

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
	// Logger records failures without entry content; nil logs nothing.
	Logger *zap.Logger
}

// ErrResultsUnencodable is a batch whose results JSON cannot carry: a 500,
// never a 200 with an empty body.
const ErrResultsUnencodable herr.Code = "evaluation_results_unencodable"

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

	logger := deps.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	mux := http.NewServeMux()
	mux.Handle("POST /go/evaluators/{family}/{evaluator}/evaluate",
		requireInternalSecret(deps.InternalSecret, evaluateRoute{api: deps.API, maxBodyBytes: deps.MaxBodyBytes, logger: logger}))
	MountTopicClustering(mux, TopicClusteringRoutes{API: deps.API, InternalSecret: deps.InternalSecret})
	return mux
}

// evaluateRoute serves one evaluate call.
type evaluateRoute struct {
	api          contract.EvaluatorRuntimeAPI
	maxBodyBytes int64
	logger       *zap.Logger
}

func (route evaluateRoute) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := httprpc.Decode[evaluateBody](w, r, route.maxBodyBytes)
	if herr.IsCode(err, httprpc.CodePayloadTooLarge) {
		err = herr.New(r.Context(), contract.ErrPayloadTooLarge, herr.M{"message": "evaluation payload too large"})
	}
	if err != nil {
		herr.WriteHTTP(w, err)
		return
	}
	results, err := route.api.Evaluate(r.Context(), contract.EvaluateRequest{
		Tenant:    contract.Tenant{ProjectID: r.Header.Get(HeaderProjectID), Env: body.Env},
		Evaluator: r.PathValue("family") + "/" + r.PathValue("evaluator"),
		Entries:   body.Data,
		Settings:  body.Settings,
		Shadow:    IsShadowCall(r),
		Trace: contract.TraceRequest{
			Traceparent: r.Header.Get(HeaderTraceparent),
			Token:       r.Header.Get(HeaderTraceToken),
		},
	})
	if err != nil {
		herr.WriteHTTP(w, err)
		return
	}
	route.writeResults(w, r, results)
}

// writeResults encodes the whole batch before answering. Only the encoder
// error's type is logged: its text may quote a byte of a raw response.
func (route evaluateRoute) writeResults(w http.ResponseWriter, r *http.Request, results []contract.Result) {
	var body bytes.Buffer
	if err := json.NewEncoder(&body).Encode(results); err != nil {
		route.logger.Error("evaluators_results_unencodable", zap.String("evaluator", r.PathValue("family")+"/"+r.PathValue("evaluator")), zap.String("error_type", fmt.Sprintf("%T", err)))
		herr.WriteHTTP(w, herr.New(r.Context(), ErrResultsUnencodable, herr.M{"message": "the evaluation results could not be encoded"}))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body.Bytes())
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
