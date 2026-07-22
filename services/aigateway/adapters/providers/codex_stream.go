package providers

import (
	"bufio"
	"bytes"
	"context"
	"io"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The codex SSE leg: the stream iterator that forwards the backend's frames
// verbatim, and the frame/usage scanners shared with the non-streaming
// aggregation in codex.go.

// codexStreamIterator forwards the backend's SSE frames verbatim (one frame
// per Chunk, `rawFraming` semantics) while skimming usage off the
// `response.completed` event for the accounting pipeline — codex tokens cost
// $0 but still count against the user's plan, so the numbers stay honest.
type codexStreamIterator struct {
	body    io.ReadCloser
	reader  *bufio.Reader
	current []byte
	usage   domain.Usage
	err     error
	done    bool
}

func (it *codexStreamIterator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	select {
	case <-ctx.Done():
		it.err = ctx.Err()
		it.close()
		return false
	default:
	}

	var frame bytes.Buffer
	for {
		line, err := it.reader.ReadBytes('\n')
		frame.Write(line)
		if err != nil {
			// The final frame may end at EOF without a trailing blank line.
			if err != io.EOF {
				it.err = err
			}
			it.close()
			if frame.Len() > 0 {
				it.emit(frame.Bytes())
				return true
			}
			return false
		}
		// A blank line terminates one SSE frame.
		if len(bytes.TrimRight(line, "\r\n")) == 0 && frame.Len() > len(line) {
			it.emit(frame.Bytes())
			return true
		}
	}
}

func (it *codexStreamIterator) emit(frame []byte) {
	it.current = frame
	if usage, ok := parseCodexUsage(frame); ok {
		it.usage = usage
	}
}

func (it *codexStreamIterator) close() {
	if !it.done {
		it.done = true
		_ = it.body.Close()
	}
}

// Close releases the upstream body; safe to call at any point (the writer
// calls it when the client disconnects mid-stream).
func (it *codexStreamIterator) Close() error {
	it.close()
	return nil
}

func (it *codexStreamIterator) Chunk() []byte       { return it.current }
func (it *codexStreamIterator) Usage() domain.Usage { return it.usage }
func (it *codexStreamIterator) Err() error          { return it.err }

// RawFraming marks chunks as pre-framed SSE bytes for the HTTP writer, the
// same contract the passthrough iterators use.
func (it *codexStreamIterator) RawFraming() bool { return true }

// codexFrameData extracts the first data payload from one SSE frame. A
// single in-place scan over the frame's lines — no per-line slice
// allocations — because it runs once per frame on both the streaming
// (usage skim) and aggregation paths.
func codexFrameData(frame []byte) ([]byte, bool) {
	for len(frame) > 0 {
		line := frame
		if i := bytes.IndexByte(frame, '\n'); i >= 0 {
			line, frame = frame[:i], frame[i+1:]
		} else {
			frame = nil
		}
		line = bytes.TrimSpace(line)
		if !bytes.HasPrefix(line, []byte("data:")) {
			continue
		}
		payload := bytes.TrimSpace(line[len("data:"):])
		if len(payload) == 0 || bytes.Equal(payload, []byte("[DONE]")) {
			continue
		}
		return payload, true
	}
	return nil, false
}

// parseCodexUsage reads token usage from a `response.completed` frame's data
// payload. The codex backend reports usage the Responses-API way:
// `response.usage.{input_tokens,output_tokens}`.
func parseCodexUsage(frame []byte) (domain.Usage, bool) {
	payload, ok := codexFrameData(frame)
	if !ok {
		return domain.Usage{}, false
	}
	eventType := gjson.GetBytes(payload, "type").String()
	if eventType != "response.completed" && eventType != "response.done" {
		return domain.Usage{}, false
	}
	usage := gjson.GetBytes(payload, "response.usage")
	if !usage.Exists() {
		return domain.Usage{}, false
	}
	in := int(usage.Get("input_tokens").Int())
	out := int(usage.Get("output_tokens").Int())
	return domain.Usage{
		PromptTokens:     in,
		CompletionTokens: out,
		TotalTokens:      in + out,
	}, true
}
