package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// maxHostedServiceBodyBytes bounds one hosted-service request. A judged text is
// capped by the classifier at about 32k tokens, so 2 MiB leaves room for the
// longest text with its questions and refuses anything that is not one.
const maxHostedServiceBodyBytes = 2 << 20

// hostedServiceHandler terminates one hosted-service route:
//
//	POST /v1/instant-evals/classify
//	GET  /v1/usage
//	PUT  /v1/budget
//
// The gateway authenticates the caller, applies the budget stop where the call
// spends, and carries the call to the control plane, which holds the one
// implementation of each service. Deliberately outside the dispatch pipeline:
// no model provider is called from here, so there is no chain to route, no
// guardrail to run and no provider credential to pick.
func hostedServiceHandler(deps RouterDeps, op domain.HostedServiceOperation) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := hostedServiceBody(deps, w, r)
		if !ok {
			return
		}
		answer, err := deps.App.CallHostedService(r.Context(), bundle, app.HostedCall{Operation: op, Body: body})
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		writeHostedAnswer(w, answer)
	}
}

// hostedServiceBody reads the request body of a call that carries one. A GET
// carries none, and reading it would only wait on a client that sends nothing.
func hostedServiceBody(deps RouterDeps, w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if r.Method == http.MethodGet {
		return nil, true
	}
	return readFullBody(deps.Logger, w, r, maxHostedServiceBodyBytes)
}

// writeHostedAnswer relays the control plane's answer as it is. A refusal gets
// the same marker a refusal authored here carries, so a client tells a named
// refusal from a proxy's error page the same way for both.
func writeHostedAnswer(w http.ResponseWriter, answer domain.HostedServiceResponse) {
	w.Header().Set("Content-Type", "application/json")
	if code := relayedErrorCode(answer); code != "" {
		w.Header().Set(herr.HandledErrorHeader, code)
	}
	w.WriteHeader(answer.StatusCode)
	_, _ = w.Write(answer.Body)
}

// relayedErrorCode reads the code of a refusal the control plane answered
// with, or "" when the answer is not one.
func relayedErrorCode(answer domain.HostedServiceResponse) string {
	if answer.StatusCode < http.StatusBadRequest {
		return ""
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(answer.Body, &envelope); err != nil {
		return ""
	}
	return envelope.Error.Code
}
