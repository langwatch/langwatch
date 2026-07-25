package herr

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"

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
//
// Type and Code always carry the same value. Type is the OpenAI-compatible
// discriminant (see docs/ai-gateway/api/errors.mdx — provider SDKs parse it and
// must keep raising their usual typed exceptions), and Code is the name the
// TypeScript side uses everywhere. Emitting both means a consumer can read
// whichever its transport taught it and always get the same answer.
type ErrorBody struct {
	Type    string      `json:"type"`
	Code    string      `json:"code"`
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
	// Code and Type always agree when we produced the envelope; prefer Code and
	// fall back to Type so a body from an older writer (Type only) still
	// resolves to the same error.
	code := body.Code
	if code == "" {
		code = body.Type
	}

	meta := M{}
	for k, v := range body.Meta {
		meta[k] = v
	}
	if body.Message != "" && body.Message != code {
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
	e := E{Code: Code(code), Meta: meta}
	if tid, err := trace.TraceIDFromHex(body.TraceID); err == nil {
		e.TraceID = tid
	}
	if sid, err := trace.SpanIDFromHex(body.SpanID); err == nil {
		e.SpanID = sid
	}
	for i := range body.Reasons {
		e.Reasons = append(e.Reasons, FromBody(body.Reasons[i]))
	}
	return e
}

// validFaults is the shared three-value fault contract — the TS side
// (HandledErrorFault, and the nlpgo envelope schema) accepts exactly these.
// Anything else in Meta["fault"] is dropped rather than emitted, so a typo
// can't fail parsing downstream.
var validFaults = map[string]bool{"customer": true, "platform": true, "provider": true}

// reservedMetaKeys are promoted to first-class ErrorBody fields and stripped
// from the exposed Meta.
var reservedMetaKeys = []string{"message", "tips", "docs_url", "fault"}

func metaString(m M, key string) string {
	s, _ := m[key].(string)
	return s
}

func metaStrings(m M, key string) []string {
	switch v := m[key].(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func toErrorBody(e E) ErrorBody {
	body := ErrorBody{
		Type:    string(e.Code),
		Code:    string(e.Code),
		Message: string(e.Code),
	}

	if msg := metaString(e.Meta, "message"); msg != "" {
		body.Message = msg
	}
	if tips := metaStrings(e.Meta, "tips"); len(tips) > 0 {
		body.Tips = tips
	}
	body.DocsURL = metaString(e.Meta, "docs_url")
	if fault := metaString(e.Meta, "fault"); validFaults[fault] {
		body.Fault = fault
	}

	// Expose Meta without the reserved keys (already promoted).
	if len(e.Meta) > 0 {
		filtered := make(M, len(e.Meta))
		for k, v := range e.Meta {
			if !slices.Contains(reservedMetaKeys, k) {
				filtered[k] = v
			}
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
