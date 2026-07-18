package herr

import (
	"encoding/json"
	"errors"
	"net/http"

	"go.opentelemetry.io/otel/trace"
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
	Tips    []string    `json:"tips,omitempty"`
	DocsURL string      `json:"docs_url,omitempty"`
	Fault   string      `json:"fault,omitempty"`
}

// ErrorRecorder can store an error for later inspection (e.g. request logging).
type ErrorRecorder interface {
	RecordError(err error)
}

// WriteHTTP writes an error as a JSON response. If the error is a herr.E,
// uses its code as the type and looks up the HTTP status. Otherwise writes
// a generic 500 with code "unknown".
//
// Exposed: code, message, meta, trace_id, span_id, reasons (herr only),
// tips, docs_url, fault.
// Not exposed: stack traces, non-herr reasons (replaced with "unknown").
func WriteHTTP(w http.ResponseWriter, err error) {
	if rec := findErrorRecorder(w); rec != nil {
		rec.RecordError(err)
	}

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

func findErrorRecorder(w http.ResponseWriter) ErrorRecorder {
	for {
		if rec, ok := w.(ErrorRecorder); ok {
			return rec
		}
		unwrapper, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return nil
		}
		w = unwrapper.Unwrap()
	}
}

// Body serializes an error to the wire envelope, for transports other than a
// direct HTTP response (frame relays, queues). The same exposure rules as
// WriteHTTP apply: code, message, meta, trace/span ids, tips, docs_url,
// fault, herr reasons; never stacks, and non-herr reasons collapse to
// "unknown".
func Body(err error) ErrorBody {
	var e E
	if !errors.As(err, &e) {
		e = E{Code: "unknown"}
	}
	return toErrorBody(e)
}

// FromBody reconstructs an E from a received wire envelope, so a typed error
// continues across a process boundary: the caller can errors.Is/IsCode on the
// code, attach it as a reason to its own herr, and re-serialize it losslessly
// (message rides Meta["message"], exactly where toErrorBody promotes it from).
// Stacks don't cross the wire; TraceID/SpanID survive when parseable.
func FromBody(body ErrorBody) E {
	meta := M{}
	for k, v := range body.Meta {
		meta[k] = v
	}
	if body.Message != "" && body.Message != body.Type {
		meta["message"] = body.Message
	}
	if len(body.Tips) > 0 {
		meta["tips"] = body.Tips
	}
	if body.DocsURL != "" {
		meta["docs_url"] = body.DocsURL
	}
	if body.Fault != "" {
		meta["fault"] = body.Fault
	}
	e := E{Code: Code(body.Type), Meta: meta}
	if tid, err := trace.TraceIDFromHex(body.TraceID); err == nil {
		e.TraceID = tid
	}
	if sid, err := trace.SpanIDFromHex(body.SpanID); err == nil {
		e.SpanID = sid
	}
	for _, reason := range body.Reasons {
		e.Reasons = append(e.Reasons, FromBody(reason))
	}
	return e
}

func toErrorBody(e E) ErrorBody {
	body := ErrorBody{
		Type:    string(e.Code),
		Message: string(e.Code),
	}

	if msg, ok := e.Meta["message"].(string); ok && msg != "" {
		body.Message = msg
	}
	if tips, ok := e.Meta["tips"]; ok {
		switch t := tips.(type) {
		case []string:
			if len(t) > 0 {
				body.Tips = t
			}
		case []any:
			for _, tip := range t {
				if s, ok := tip.(string); ok && s != "" {
					body.Tips = append(body.Tips, s)
				}
			}
		}
	}
	if docsURL, ok := e.Meta["docs_url"].(string); ok && docsURL != "" {
		body.DocsURL = docsURL
	}
	if fault, ok := e.Meta["fault"].(string); ok && fault != "" {
		body.Fault = fault
	}

	// Expose Meta without "message"/"tips"/"docs_url"/"fault" (already promoted).
	if len(e.Meta) > 0 {
		filtered := make(M, len(e.Meta))
		for k, v := range e.Meta {
			switch k {
			case "message", "tips", "docs_url", "fault":
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
