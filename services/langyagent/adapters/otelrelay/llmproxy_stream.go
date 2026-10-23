package otelrelay

import (
	"bytes"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

// llmStreamSniffer watches a mediated LLM call's 200 SSE body as it streams
// through the relay UNTOUCHED, looking for an in-stream terminal error event
// (`data: {"type":"error","error":{...}}`, how OpenAI signals a hard limit
// like insufficient_quota after the stream is already 200-established).
//
// Status-based retry cutting (see handleLLM's ModifyResponse) never sees these
// failures. A hard-limit discriminant latches on the first event by arming
// llmStreamCut, which makes handleLLM answer the conversation's NEXT call with
// a terminal 400 carrying the provider's own error payload: every retry would
// be answered the same way. Any other in-stream error (an overloaded provider,
// a server error) is only captured: the worker retries it a bounded number of
// times (services/langyworker/src/model-retry.ts), and a cut here would end
// those retries with a 400 of the relay's own making. A stream that ends
// cleanly (EOF with no error event) clears the capture, mirroring the
// 2xx-clears-capture rule.
//
// One more shape rides under the SSE content type: the gateway can forward an
// upstream REJECTION as a 200 whose body is a single bare JSON error object
// with no event framing at all (seen live: Anthropic refusing a request
// parameter). promoteBareJSONStreamError answers such a body with its error
// status before the sniffer runs; one too large to promote reaches the
// sniffer, which buffers it (bounded) and inspects it at EOF as the same
// error-event payload, so the clean-end rule does not CLEAR the capture.
type llmStreamSniffer struct {
	body     io.ReadCloser
	entry    *workerEntry
	logger   *zap.Logger
	line     []byte
	sawError bool
	// lineOverflow marks a data line that outgrew maxErrorBodyBytes; the
	// remainder is discarded unscanned (token deltas never get that big, and
	// a bounded buffer keeps a pathological stream from ballooning memory).
	lineOverflow bool
	// started flips on the first non-whitespace byte, when the body commits to
	// one of two shapes: SSE framing, or one bare JSON object (bareJSON), which
	// accumulates whole into `line` and is inspected at EOF.
	started  bool
	bareJSON bool
}

func isEventStream(resp *http.Response) bool {
	return strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream")
}

// promoteBareJSONStreamError answers a 200 event stream whose whole body is one
// bare JSON error object with the status that error stands for. Passed through
// as a 200, the worker's SDK read it as a stream that ended without a stop
// reason and retried a spent credit balance five times. Any other body is put
// back untouched and streams as before.
func promoteBareJSONStreamError(resp *http.Response) {
	orig := resp.Body
	head, complete := readBareJSONHead(orig)
	restore := func() {
		resp.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(head), orig), orig}
	}
	if !complete || gjson.GetBytes(head, "type").Str != "error" {
		restore()
		return
	}
	status := bareErrorStatus(gjson.GetBytes(head, "error.type").Str)
	resp.StatusCode = status
	resp.Status = strconv.Itoa(status) + " " + http.StatusText(status)
	resp.Header.Set("Content-Type", "application/json")
	resp.Header.Set("Content-Length", strconv.Itoa(len(head)))
	resp.ContentLength = int64(len(head))
	restore()
}

// readBareJSONHead reads up to the first non-whitespace byte and, when it opens
// a JSON object, the rest of the body (bounded). complete is true only for a
// bare JSON body read to its end; SSE framing stops the read at its first byte.
func readBareJSONHead(body io.Reader) (head []byte, complete bool) {
	buf := make([]byte, 512)
	for {
		n, err := body.Read(buf)
		head = append(head, buf[:n]...)
		if trimmed := bytes.TrimLeft(head, " \t\r\n"); len(trimmed) > 0 {
			if trimmed[0] != '{' {
				return head, false
			}
			if err == io.EOF {
				return head, true
			}
			rest, readErr := io.ReadAll(io.LimitReader(body, int64(maxErrorBodyBytes-len(head)+1)))
			head = append(head, rest...)
			return head, readErr == nil && len(head) <= maxErrorBodyBytes
		}
		if err != nil || len(head) > maxErrorBodyBytes {
			return head, false
		}
	}
}

// bareErrorStatus maps a provider error type to the HTTP status the provider
// answers it with, so a transient failure keeps the SDK's retries and a
// deterministic one ends them. Unknown types read as a 400.
func bareErrorStatus(errorType string) int {
	switch errorType {
	case "rate_limit_error", "rate_limit_exceeded":
		return http.StatusTooManyRequests
	case "overloaded_error":
		return 529
	case "api_error", "server_error":
		return http.StatusInternalServerError
	case "timeout_error":
		return http.StatusGatewayTimeout
	case "authentication_error":
		return http.StatusUnauthorized
	case "permission_error":
		return http.StatusForbidden
	case "not_found_error":
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func newLLMStreamSniffer(body io.ReadCloser, entry *workerEntry, logger *zap.Logger) io.ReadCloser {
	return &llmStreamSniffer{body: body, entry: entry, logger: logger}
}

func (s *llmStreamSniffer) Read(p []byte) (int, error) {
	n, err := s.body.Read(p)
	if n > 0 {
		s.scan(p[:n])
	}
	if err == io.EOF {
		if s.bareJSON && !s.sawError && !s.lineOverflow {
			// The whole body was one unframed JSON object; only now is it
			// complete enough to inspect.
			s.inspectPayload(s.line)
		}
		if !s.sawError {
			// The stream ended without a terminal error event: a healthy call.
			s.entry.clearLLMError()
		}
	}
	return n, err
}

func (s *llmStreamSniffer) Close() error {
	return s.body.Close()
}

// scan accumulates the passthrough bytes into SSE lines and inspects each
// complete `data: ...` payload for a terminal error event. A body that opens
// with `{` instead of SSE framing is buffered whole for the EOF inspection.
func (s *llmStreamSniffer) scan(chunk []byte) {
	if s.sawError {
		return
	}
	if !s.started {
		content := bytes.TrimLeft(chunk, " \t\r\n")
		if len(content) == 0 {
			return // pure whitespace decides nothing; keep waiting
		}
		s.started = true
		s.bareJSON = content[0] == '{'
	}
	if s.bareJSON {
		s.buffer(chunk)
		return
	}
	for len(chunk) > 0 {
		nl := bytes.IndexByte(chunk, '\n')
		if nl < 0 {
			s.buffer(chunk)
			return
		}
		s.buffer(chunk[:nl])
		if !s.lineOverflow {
			s.inspectLine(bytes.TrimSuffix(s.line, []byte("\r")))
		}
		s.line = s.line[:0]
		s.lineOverflow = false
		chunk = chunk[nl+1:]
		if s.sawError {
			return
		}
	}
}

func (s *llmStreamSniffer) buffer(part []byte) {
	if s.lineOverflow {
		return
	}
	if len(s.line)+len(part) > maxErrorBodyBytes {
		s.lineOverflow = true
		s.line = s.line[:0]
		return
	}
	s.line = append(s.line, part...)
}

var (
	sseDataLinePrefix = []byte("data: ")
	// A cheap gate in front of the gjson parse, which would otherwise run on
	// every chunk of every healthy stream. It matches the quoted VALUE alone,
	// not `"type":"error"`, because a provider is free to emit
	// `{"type": "error"}` with the space and the byte-exact form would then
	// drop a real terminal error on the floor. gjson below is the
	// discriminator; this only decides what is worth parsing.
	errorEventTypeMark = []byte(`"error"`)
)

func (s *llmStreamSniffer) inspectLine(line []byte) {
	payload, ok := bytes.CutPrefix(line, sseDataLinePrefix)
	if !ok {
		return
	}
	s.inspectPayload(payload)
}

// inspectPayload captures a terminal error payload — a framed `data:` event's
// JSON, or the whole bare-JSON body at EOF. Both carry the same
// `{"type":"error","error":{...}}` object.
func (s *llmStreamSniffer) inspectPayload(payload []byte) {
	if !bytes.Contains(payload, errorEventTypeMark) {
		return
	}
	if gjson.GetBytes(payload, "type").Str != "error" {
		return
	}
	s.sawError = true

	// Same capture shape as a rejected call: a known provider discriminant
	// (error.type) rides as a typed reason for the panel's classification, and
	// the provider's own prose stays out of the frame.
	//
	// Decoded as provider-native outright rather than through
	// decodeLLMErrorBody's gateway-envelope test. This is an error event inside
	// a 200 stream; the gateway reports its own failures as non-200 JSON, so
	// there is no envelope to find here — and OpenAI's quota body would satisfy
	// that test by coincidence and carry its prose through as though we had
	// written it.
	e := decodeProviderErrorBody(payload, 0, "text/event-stream")
	s.entry.setLLMError(e)

	// The consecutive-429 count is left to the status path: an in-stream error
	// is not a rejected call, and counting it would let a later burst of 429s
	// reach the cut sooner and end the worker's retries.
	if !hasHardLimitReason(e) {
		s.logger.Info("otelrelay llm in-stream error event captured",
			zap.String("conversation", s.entry.info.ConversationID))
		return
	}

	// Arm the terminal answer for the next retry with the provider's own
	// error object, rewrapped as the standard HTTP error body shape
	// ({"error":{...}}) the worker SDK decodes.
	cutBody := payload
	if inner := gjson.GetBytes(payload, "error"); inner.Exists() && inner.IsObject() {
		cutBody = []byte(`{"error":` + inner.Raw + `}`)
	}
	s.entry.latchLLMStreamCut(cutBody)
	s.logger.Info("otelrelay llm in-stream failure latched for retry cut",
		zap.String("conversation", s.entry.info.ConversationID),
		zap.Bool("hard_limit", true))
}
