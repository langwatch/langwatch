package providers

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The LangWatch-to-LangWatch SSE leg: the iterator that forwards the far
// gateway's frames verbatim while skimming usage off whichever frame carries
// it, so the install's own accounting has the numbers without parsing the
// stream twice.

// langWatchStreamIterator emits one SSE frame per chunk (`rawFraming`
// semantics), the same contract the codex and passthrough iterators use.
type langWatchStreamIterator struct {
	body    io.ReadCloser
	reader  *bufio.Reader
	current []byte
	usage   domain.Usage
	err     error
	done    bool
}

func (it *langWatchStreamIterator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	if err := ctx.Err(); err != nil {
		it.err = err
		it.close()
		return false
	}

	frame, err := it.readFrame()
	if err != nil {
		// The final frame may end at EOF without a trailing blank line, so
		// what was read is still emitted; anything else is a real read error.
		if !errors.Is(err, io.EOF) {
			it.err = err
		}
		it.close()
	}
	if len(frame) == 0 {
		return false
	}
	it.emit(frame)
	return true
}

// readFrame reads one SSE frame: the lines up to the blank line that
// terminates it, or whatever arrived before the stream ended.
func (it *langWatchStreamIterator) readFrame() ([]byte, error) {
	var frame bytes.Buffer
	for {
		line, err := it.reader.ReadBytes('\n')
		frame.Write(line)
		if err != nil {
			return frame.Bytes(), err
		}
		if len(bytes.TrimRight(line, "\r\n")) == 0 && frame.Len() > len(line) {
			return frame.Bytes(), nil
		}
	}
}

func (it *langWatchStreamIterator) emit(frame []byte) {
	it.current = frame
	if usage, ok := parseLangWatchStreamUsage(frame); ok {
		it.usage = usage
	}
}

func (it *langWatchStreamIterator) close() {
	if !it.done {
		it.done = true
		_ = it.body.Close()
	}
}

// Close releases the upstream body; safe at any point, and what the writer
// calls when the install's caller disconnects mid-stream.
func (it *langWatchStreamIterator) Close() error {
	it.close()
	return nil
}

func (it *langWatchStreamIterator) Chunk() []byte       { return it.current }
func (it *langWatchStreamIterator) Usage() domain.Usage { return it.usage }
func (it *langWatchStreamIterator) Err() error          { return it.err }

// RawFraming marks chunks as pre-framed SSE bytes for the HTTP writer.
func (it *langWatchStreamIterator) RawFraming() bool { return true }

// parseLangWatchStreamUsage reads token usage from one SSE frame. Both the
// chat-completions dialect (a trailing chunk carrying `usage`) and the
// Responses dialect (`response.usage` on the completed event) are read, since
// the far gateway serves the request type the caller asked for.
func parseLangWatchStreamUsage(frame []byte) (domain.Usage, bool) {
	payload, ok := codexFrameData(frame)
	if !ok {
		return domain.Usage{}, false
	}
	if usage, found := responsesStyleUsage(payload); found {
		return usage, true
	}
	usage := gjson.GetBytes(payload, "usage")
	if !usage.Exists() {
		return domain.Usage{}, false
	}
	in := int(usage.Get("prompt_tokens").Int())
	out := int(usage.Get("completion_tokens").Int())
	total := int(usage.Get("total_tokens").Int())
	if total == 0 {
		total = in + out
	}
	return domain.Usage{
		PromptTokens:     in,
		CompletionTokens: out,
		TotalTokens:      total,
		CacheReadTokens:  int(usage.Get("prompt_tokens_details.cached_tokens").Int()),
	}, true
}

// responsesStyleUsage reads the Responses-API usage block, where the counts
// are named input_tokens and output_tokens and sit under `response`.
func responsesStyleUsage(payload []byte) (domain.Usage, bool) {
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
		CacheReadTokens:  int(usage.Get("input_tokens_details.cached_tokens").Int()),
	}, true
}
