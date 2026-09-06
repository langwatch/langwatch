package otelrelay

import (
	"bytes"
	"io"

	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

// llmStreamSniffer watches a mediated LLM call's 200 SSE body as it streams
// through the relay UNTOUCHED, looking for an in-stream terminal error event
// (`data: {"type":"error","error":{...}}`, how OpenAI signals a hard limit
// like insufficient_quota after the stream is already 200-established).
//
// Status-based retry cutting (see handleLLM's ModifyResponse) never sees these
// failures: the SDK's retry re-opens a fresh 200 stream and dies identically,
// forever. The sniffer closes that gap on the SAME strike rules, a hard-limit
// discriminant latches on the first event, anything else latches at
// rateLimitCutAfter consecutive strikes, by arming llmStreamCut, which makes
// handleLLM answer the conversation's NEXT call with a terminal 400 carrying
// the provider's own error payload. A stream that ends cleanly (EOF with no
// error event) clears the capture, mirroring the 2xx-clears-capture rule.
//
// One more shape rides under the SSE content type: the gateway can forward an
// upstream REJECTION as a 200 whose body is a single bare JSON error object
// with no event framing at all (seen live: Anthropic refusing a request
// parameter). A body whose first byte is `{` is not SSE, so the sniffer
// buffers it whole (bounded) and inspects it at EOF as the same error-event
// payload — without this, the clean-end rule would CLEAR the capture and the
// turn would fail with no cause on record.
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

	hard := hasHardLimitReason(e)
	strikes := s.entry.strikeRateLimit()
	if !hard && strikes < rateLimitCutAfter {
		s.logger.Info("otelrelay llm in-stream error event captured",
			zap.String("conversation", s.entry.info.ConversationID),
			zap.Int("consecutive", strikes))
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
		zap.Bool("hard_limit", hard),
		zap.Int("consecutive", strikes))
}
