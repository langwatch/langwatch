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
}

func newLLMStreamSniffer(body io.ReadCloser, entry *workerEntry, logger *zap.Logger) io.ReadCloser {
	return &llmStreamSniffer{body: body, entry: entry, logger: logger}
}

func (s *llmStreamSniffer) Read(p []byte) (int, error) {
	n, err := s.body.Read(p)
	if n > 0 {
		s.scan(p[:n])
	}
	if err == io.EOF && !s.sawError {
		// The stream ended without a terminal error event: a healthy call.
		s.entry.clearLLMError()
	}
	return n, err
}

func (s *llmStreamSniffer) Close() error {
	return s.body.Close()
}

// scan accumulates the passthrough bytes into SSE lines and inspects each
// complete `data: ...` payload for a terminal error event.
func (s *llmStreamSniffer) scan(chunk []byte) {
	if s.sawError {
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
	sseDataLinePrefix  = []byte("data: ")
	errorEventTypeMark = []byte(`"type":"error"`)
)

func (s *llmStreamSniffer) inspectLine(line []byte) {
	payload, ok := bytes.CutPrefix(line, sseDataLinePrefix)
	if !ok || !bytes.Contains(payload, errorEventTypeMark) {
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
	e := decodeProviderErrorBody(payload)
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
