package herr

import (
	"encoding/json"
	"errors"
	"net/http"
)

// StatusCode maps a herr Code to an HTTP status. Override with RegisterStatus.
var codeStatus = map[Code]int{}

// RegisterStatus maps a herr code to an HTTP status code.
// Call at init time to configure your app's error → status mapping.
func RegisterStatus(code Code, status int) {
	codeStatus[code] = status
}

// HTTPStatus returns the HTTP status for an error. If the error is a herr.E
// with a registered code, returns that status. Otherwise returns 500.
func HTTPStatus(err error) int {
	var e E
	if errors.As(err, &e) {
		if status, ok := codeStatus[e.Code]; ok {
			return status
		}
	}
	return http.StatusInternalServerError
}

// ErrorResponse is the standard JSON error envelope.
type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

// ErrorBody is the error detail within the envelope.
type ErrorBody struct {
	Type    string      `json:"type"`
	Message string      `json:"message"`
	Meta    M           `json:"meta,omitempty"`
	TraceID string      `json:"trace_id,omitempty"`
	SpanID  string      `json:"span_id,omitempty"`
	Reasons []ErrorBody `json:"reasons,omitempty"`
}

// WriteHTTP writes an error as a JSON response. If the error is a herr.E,
// uses its code as the type and looks up the HTTP status. Otherwise writes
// a generic 500 with code "unknown".
//
// Exposed: code, message, meta, trace_id, span_id, reasons (herr only).
// Not exposed: stack traces, non-herr reasons (replaced with "unknown").
func WriteHTTP(w http.ResponseWriter, err error) {
	var e E
	if !errors.As(err, &e) {
		e = E{Code: "unknown"}
	}

	status := http.StatusInternalServerError
	if s, ok := codeStatus[e.Code]; ok {
		status = s
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorResponse{Error: toErrorBody(e)})
}

func toErrorBody(e E) ErrorBody {
	body := ErrorBody{
		Type:    string(e.Code),
		Message: string(e.Code),
	}

	if msg, ok := e.Meta["message"].(string); ok && msg != "" {
		body.Message = msg
	}

	// Expose Meta without "message" (already promoted).
	if len(e.Meta) > 0 {
		filtered := make(M, len(e.Meta))
		for k, v := range e.Meta {
			if k == "message" {
				continue
			}
			filtered[k] = v
		}
		if len(filtered) > 0 {
			body.Meta = filtered
		}
	}

	if e.TraceID.IsValid() {
		body.TraceID = e.TraceID.String()
	}
	if e.SpanID.IsValid() {
		body.SpanID = e.SpanID.String()
	}

	for _, reason := range e.Reasons {
		var he E
		if errors.As(reason, &he) {
			body.Reasons = append(body.Reasons, toErrorBody(he))
		} else {
			body.Reasons = append(body.Reasons, ErrorBody{
				Type:    "unknown",
				Message: "unknown",
			})
		}
	}

	return body
}
