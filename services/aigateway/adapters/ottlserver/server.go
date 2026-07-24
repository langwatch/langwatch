// Package ottlserver exposes HTTP endpoints that compile and execute
// OpenTelemetry Transformation Language (OTTL) statements against
// inbound OTLP payloads on behalf of the LangWatch control plane.
//
// The control plane stores `parserConfig.ottlStatements` per
// IngestionSource and proxies all OTTL work here so that the canonical
// TypeScript pdata pipeline never needs an OTTL implementation in
// JavaScript. Two endpoints are exposed:
//
//	POST /internal/validate-ottl
//	  body: { statements: []string }
//	  200:  { ok: true }
//	      | { ok: false, errors: [{ statement_index, line, col, message }] }
//
//	POST /internal/transform
//	  body: { source_id, kind: "log"|"metric",
//	          encoding: "proto"|"json",
//	          payload_b64,
//	          payload_proto_b64 (legacy alias for payload_b64),
//	          statements: []string }
//	  200:  { ok: true, payload_b64, encoding }
//	      | { ok: false, errors: [...] }
//
// Wire shape locked with the control plane's
// `langwatch/ee/governance/services/activity-monitor/ottlGatewayClient.ts`.
//
// All endpoints are mounted under `/internal/*` and gated by the same
// HMAC-signed channel the rest of the control-plane↔gateway internal
// surface uses (`LW_GATEWAY_INTERNAL_SECRET`). The middleware lives in
// `services/aigateway/adapters/httpapi`.
package ottlserver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/open-telemetry/opentelemetry-collector-contrib/pkg/ottl"
	"github.com/open-telemetry/opentelemetry-collector-contrib/pkg/ottl/contexts/ottllog"
	"github.com/open-telemetry/opentelemetry-collector-contrib/pkg/ottl/ottlfuncs"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.uber.org/zap"
)

// Server holds the parsers shared across requests. Building a parser
// (which compiles the function table) is comparatively expensive, so
// we keep one per OTTL context and re-use it across statements.
type Server struct {
	logger    *zap.Logger
	logParser ottl.Parser[*ottllog.TransformContext]
}

// New builds a Server with the standard ottlfuncs function set wired
// to the logs context. Returns an error only when the upstream
// constructors reject our settings — practically, never.
func New(logger *zap.Logger) (*Server, error) {
	if logger == nil {
		logger = zap.NewNop()
	}
	settings := component.TelemetrySettings{Logger: logger}
	parser, err := ottllog.NewParser(ottlfuncs.StandardFuncs[*ottllog.TransformContext](), settings)
	if err != nil {
		return nil, fmt.Errorf("ottllog parser init: %w", err)
	}
	return &Server{logger: logger, logParser: parser}, nil
}

// ── wire shapes ─────────────────────────────────────────────────────

type validateRequest struct {
	Statements []string `json:"statements"`
}

type transformRequest struct {
	SourceID   string `json:"source_id"`
	Kind       string `json:"kind"`
	Encoding   string `json:"encoding"`
	PayloadB64 string `json:"payload_b64"`
	// LegacyPayloadB64 is the original sergey contract field name.
	// Kept on the wire so an old TS client (or an older gateway)
	// can roll out independently. Prefer `payload_b64`.
	LegacyPayloadB64 string   `json:"payload_proto_b64,omitempty"`
	Statements       []string `json:"statements"`
}

type errorPayload struct {
	StatementIndex int    `json:"statement_index"`
	Line           int    `json:"line"`
	Col            int    `json:"col"`
	Message        string `json:"message"`
}

type validateResponse struct {
	OK     bool           `json:"ok"`
	Errors []errorPayload `json:"errors,omitempty"`
}

type transformResponse struct {
	OK         bool           `json:"ok"`
	PayloadB64 string         `json:"payload_b64,omitempty"`
	Encoding   string         `json:"encoding,omitempty"`
	Errors     []errorPayload `json:"errors,omitempty"`
}

// ── handlers ────────────────────────────────────────────────────────

// HandleValidate parses a list of statements without executing them
// and returns the per-statement parse errors. A successful parse
// returns `{ ok: true }`.
func (s *Server) HandleValidate(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(r, validateMaxBodyBytes)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	var req validateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}
	if len(req.Statements) == 0 {
		writeJSON(w, http.StatusOK, validateResponse{OK: true})
		return
	}
	errs := s.parseAll(req.Statements)
	if len(errs) == 0 {
		writeJSON(w, http.StatusOK, validateResponse{OK: true})
		return
	}
	writeJSON(w, http.StatusOK, validateResponse{OK: false, Errors: errs})
}

// HandleTransform parses + executes the statements over the supplied
// OTLP payload and returns the mutated bytes. Only the logs context
// is implemented in this iteration — the dogfood-blocking surface is
// `claude_code.api_request` log records. Metrics support is stubbed.
func (s *Server) HandleTransform(w http.ResponseWriter, r *http.Request) {
	body, err := readBody(r, transformMaxBodyBytes)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	var req transformRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_json", err.Error())
		return
	}

	encoding := req.Encoding
	if encoding == "" {
		encoding = "proto"
	}
	if encoding != "proto" && encoding != "json" {
		writeProblem(w, http.StatusBadRequest, "invalid_encoding", "encoding must be \"proto\" or \"json\"")
		return
	}

	payloadB64 := req.PayloadB64
	if payloadB64 == "" {
		payloadB64 = req.LegacyPayloadB64
	}
	if payloadB64 == "" {
		writeProblem(w, http.StatusBadRequest, "missing_payload", "payload_b64 (or legacy payload_proto_b64) is required")
		return
	}
	rawPayload, err := base64.StdEncoding.DecodeString(payloadB64)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_payload_b64", err.Error())
		return
	}

	switch req.Kind {
	case "", "log":
		s.transformLogs(w, r.Context(), encoding, rawPayload, req.Statements)
		return
	case "metric":
		// Not yet implemented — the dogfood surface is logs only.
		// Returning a structured error lets the TS client distinguish
		// "unimplemented kind" from "your statements are malformed".
		writeProblem(w, http.StatusNotImplemented, "metric_transform_unsupported",
			"metric transform not implemented in this gateway build; logs only")
		return
	default:
		writeProblem(w, http.StatusBadRequest, "invalid_kind",
			fmt.Sprintf("kind must be \"log\" or \"metric\"; got %q", req.Kind))
		return
	}
}

func (s *Server) transformLogs(w http.ResponseWriter, ctx context.Context, encoding string, raw []byte, statements []string) {
	logs, err := unmarshalLogs(encoding, raw)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_otlp_payload", err.Error())
		return
	}

	// Parse first to surface per-statement errors before we touch any record.
	parsed, parseErrs := s.parseLogStatements(statements)
	if len(parseErrs) > 0 {
		writeJSON(w, http.StatusOK, transformResponse{OK: false, Errors: parseErrs})
		return
	}

	// Execute every parsed statement against every (resource, scope, record)
	// triple. OTTL mutates the record in place via pcommon.Map references.
	//
	// Principal-field guard (snapshot+restore) wraps each record's
	// statement loop so any OTTL rule that touches a protected
	// attribute is silently reverted post-transform. This is a
	// defense-in-depth pass — even a misconfigured / hostile rule
	// cannot rewrite the credential-derived attribution that the
	// receiver + downstream OCSF/SIEM/forensics surfaces depend on.
	// See principal_guard.go for the protected-key list + rationale.
	rls := logs.ResourceLogs()
	for i := 0; i < rls.Len(); i++ {
		rl := rls.At(i)
		sls := rl.ScopeLogs()
		for j := 0; j < sls.Len(); j++ {
			sl := sls.At(j)
			lrs := sl.LogRecords()
			for k := 0; k < lrs.Len(); k++ {
				lr := lrs.At(k)
				snapshot := snapshotProtectedAttrs(rl, sl, lr)
				tCtx := ottllog.NewTransformContextPtr(rl, sl, lr)
				for _, stmt := range parsed {
					if _, _, err := stmt.Execute(ctx, tCtx); err != nil {
						// A runtime error on one record shouldn't kill
						// the whole batch — log + continue. The TS
						// receiver can compare event counts pre/post
						// for monitoring.
						s.logger.Warn("ottl_statement_runtime_error",
							zap.String("origin", "ottlserver.transformLogs"),
							zap.Error(err))
					}
				}
				tCtx.Close()
				restoreProtectedAttrs(rl, sl, lr, snapshot)
			}
		}
	}

	out, err := marshalLogs(encoding, logs)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "marshal_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, transformResponse{
		OK:         true,
		PayloadB64: base64.StdEncoding.EncodeToString(out),
		Encoding:   encoding,
	})
}

// parseAll runs through `statements` and returns one errorPayload per
// statement that failed. Used by both /validate-ottl and /transform.
func (s *Server) parseAll(statements []string) []errorPayload {
	_, errs := s.parseLogStatements(statements)
	return errs
}

func (s *Server) parseLogStatements(statements []string) ([]*ottl.Statement[*ottllog.TransformContext], []errorPayload) {
	parsed := make([]*ottl.Statement[*ottllog.TransformContext], 0, len(statements))
	var errs []errorPayload
	for i, raw := range statements {
		stmt, err := s.logParser.ParseStatement(raw)
		if err != nil {
			line, col := extractPosition(err.Error())
			errs = append(errs, errorPayload{
				StatementIndex: i,
				Line:           line,
				Col:            col,
				Message:        err.Error(),
			})
			continue
		}
		parsed = append(parsed, stmt)
	}
	return parsed, errs
}

// ── codec helpers ───────────────────────────────────────────────────

func unmarshalLogs(encoding string, raw []byte) (plog.Logs, error) {
	switch encoding {
	case "proto":
		u := plog.ProtoUnmarshaler{}
		return u.UnmarshalLogs(raw)
	case "json":
		u := plog.JSONUnmarshaler{}
		return u.UnmarshalLogs(raw)
	}
	return plog.Logs{}, fmt.Errorf("unsupported encoding: %s", encoding)
}

func marshalLogs(encoding string, logs plog.Logs) ([]byte, error) {
	switch encoding {
	case "proto":
		m := plog.ProtoMarshaler{}
		return m.MarshalLogs(logs)
	case "json":
		m := plog.JSONMarshaler{}
		return m.MarshalLogs(logs)
	}
	return nil, fmt.Errorf("unsupported encoding: %s", encoding)
}

// extractPosition is a best-effort scrape of "line N: column M:" from
// the participle error message that pkg/ottl wraps. When the parser
// reports a deeper failure (e.g. unknown function), we have no line
// info — return (0, 0) and let the message carry the detail.
func extractPosition(msg string) (line, col int) {
	// participle errors look like:
	//   1:7: unexpected token "..."
	// or "unable to parse OTTL statement \"...\": 1:7: unexpected token \"...\""
	// We scan for the first NN:MM: triple.
	for i := 0; i < len(msg); i++ {
		if msg[i] >= '0' && msg[i] <= '9' {
			j := i
			for j < len(msg) && msg[j] >= '0' && msg[j] <= '9' {
				j++
			}
			if j < len(msg) && msg[j] == ':' {
				k := j + 1
				for k < len(msg) && msg[k] >= '0' && msg[k] <= '9' {
					k++
				}
				if k > j+1 && k < len(msg) && msg[k] == ':' {
					line = parseUint(msg[i:j])
					col = parseUint(msg[j+1 : k])
					return
				}
			}
			i = j
		}
	}
	return 0, 0
}

func parseUint(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}

// ── http helpers ────────────────────────────────────────────────────

const (
	// 256KB is generous for statement lists; the TS UI caps composer
	// input at ~64KB before posting.
	validateMaxBodyBytes = 256 * 1024

	// OTLP batches from a busy collector can be multi-MB; 32MB leaves
	// room. Sized independently of the chat-completion body cap — this is
	// internal OTLP transform traffic, not large-context LLM payloads.
	transformMaxBodyBytes = 32 * 1024 * 1024
)

func readBody(r *http.Request, maxBytes int64) ([]byte, error) {
	limited := http.MaxBytesReader(nil, r.Body, maxBytes)
	defer r.Body.Close()
	return io.ReadAll(limited)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	buf, err := json.Marshal(body)
	if err != nil {
		http.Error(w, `{"error":{"code":"marshal_failed"}}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(buf)
}

func writeProblem(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"ok": false,
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}
