package providers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The streamed audio lanes: a provider's body relayed to the caller as it
// arrives, one socket read per chunk, with the usage read off the stream on
// the way through.

const (
	// audioStreamReadBytes is one relay read. Small enough that the first
	// audio frames leave at once, large enough that a fast body is not
	// relayed in slivers.
	audioStreamReadBytes = 16 << 10

	// audioStreamFrameCap bounds the event the usage scanner holds while it
	// waits for the frame to end. A larger frame is skipped, never buffered.
	audioStreamFrameCap = 4 << 20

	speechDoneEvent     = "speech.audio.done"
	transcriptDoneEvent = "transcript.text.done"
)

// audioMeter settles what a streamed audio call is charged.
type audioMeter struct {
	// cut is the charge when the stream ends before its final event, and the
	// whole charge on a stream that has no final event (raw audio bytes).
	cut domain.Usage
	// finalEvent names the event that carries the provider's own usage.
	// Empty on a stream of raw audio.
	finalEvent string
	// final reads the usage off that event, starting from cut.
	final func(payload []byte, cut domain.Usage) domain.Usage

	pending  []byte
	skipping bool
	settled  *domain.Usage
}

// expectsFinal reports whether this stream ends with a usage event.
func (m *audioMeter) expectsFinal() bool { return m.finalEvent != "" }

func (m *audioMeter) usage() domain.Usage {
	if m.settled != nil {
		return *m.settled
	}
	return m.cut
}

// observe scans relayed bytes for the final event. Reads do not align with
// event frames, so the unfinished frame is carried over to the next read.
func (m *audioMeter) observe(chunk []byte) {
	if !m.expectsFinal() || m.settled != nil {
		return
	}
	m.pending = append(m.pending, chunk...)
	for {
		end := sseFrameEnd(m.pending)
		if end < 0 {
			break
		}
		frame := m.pending[:end]
		if !m.skipping {
			m.readFrame(frame)
		}
		m.skipping = false
		m.pending = m.pending[end:]
	}
	if len(m.pending) > audioStreamFrameCap {
		m.pending, m.skipping = m.pending[:0], true
	}
}

func (m *audioMeter) readFrame(frame []byte) {
	if !bytes.Contains(frame, []byte(m.finalEvent)) {
		return
	}
	payload, ok := codexFrameData(frame)
	if !ok || gjson.GetBytes(payload, "type").String() != m.finalEvent {
		return
	}
	usage := m.final(payload, m.cut)
	m.settled = &usage
}

// sseFrameEnd returns the offset just past the first complete SSE frame, or
// -1 when the buffer holds none. A frame ends at a blank line.
func sseFrameEnd(b []byte) int {
	for i := 0; i < len(b); i++ {
		if b[i] != '\n' {
			continue
		}
		if i+1 < len(b) && b[i+1] == '\n' {
			return i + 2
		}
		if i+2 < len(b) && b[i+1] == '\r' && b[i+2] == '\n' {
			return i + 3
		}
	}
	return -1
}

// audioStreamIterator relays a provider's response body, one read per chunk.
// Chunks are the provider's own bytes, so the writer forwards them unframed.
type audioStreamIterator struct {
	body    io.ReadCloser
	headers map[string]string
	meter   *audioMeter
	// limit caps the relayed bytes as a running count. Zero means no cap.
	limit   int64
	relayed int64
	buf     []byte
	current []byte
	// ended holds the read error that arrived with the last chunk, so that
	// chunk is still delivered before the stream closes.
	ended error
	err   error
	done  bool
}

func newAudioStream(resp *http.Response, headers map[string]string, meter *audioMeter) *audioStreamIterator {
	return &audioStreamIterator{
		body:    resp.Body,
		headers: headers,
		meter:   meter,
		buf:     make([]byte, audioStreamReadBytes),
	}
}

func (it *audioStreamIterator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	if err := ctx.Err(); err != nil {
		return it.finish(err)
	}
	if it.ended != nil {
		return it.finish(it.ended)
	}
	n, err := it.readSome()
	if n == 0 {
		return it.finish(err)
	}
	it.relayed += int64(n)
	if it.limit > 0 && it.relayed > it.limit {
		return it.finish(herr.New(ctx, domain.ErrProviderError, herr.M{
			"message": fmt.Sprintf("the provider's audio response exceeded %d bytes", it.limit),
			"fault":   "provider",
		}))
	}
	it.current = it.buf[:n]
	it.meter.observe(it.current)
	it.ended = err
	return true
}

// readSome blocks until the provider sends bytes or the body ends. A reader
// may return no bytes and no error, which is not an end.
func (it *audioStreamIterator) readSome() (int, error) {
	for {
		n, err := it.body.Read(it.buf)
		if n > 0 || err != nil {
			return n, err
		}
	}
}

// finish closes the stream. A clean end is io.EOF with the final event seen,
// or io.EOF on a stream that has no final event; anything else is a cut.
func (it *audioStreamIterator) finish(cause error) bool {
	it.done = true
	it.current = nil
	_ = it.body.Close()
	switch {
	case !errors.Is(cause, io.EOF):
		it.err = cause
	case it.meter.expectsFinal() && it.meter.settled == nil:
		it.err = &domain.UpstreamError{
			StatusCode: http.StatusBadGateway,
			Message:    "the provider closed the stream before its " + it.meter.finalEvent + " event",
		}
	}
	return false
}

func (it *audioStreamIterator) Chunk() []byte       { return it.current }
func (it *audioStreamIterator) Usage() domain.Usage { return it.meter.usage() }
func (it *audioStreamIterator) Err() error          { return it.err }
func (it *audioStreamIterator) RawFraming() bool    { return true }

func (it *audioStreamIterator) StreamHeaders() map[string]string { return it.headers }

// Close releases the provider connection. Closing an unfinished stream stops
// the provider's generation where the transport allows it.
func (it *audioStreamIterator) Close() error {
	if !it.done {
		it.done = true
		_ = it.body.Close()
	}
	return nil
}

// speechDoneUsage reads the token usage OpenAI states on speech.audio.done,
// kept beside the character count the request was dispatched with.
func speechDoneUsage(payload []byte, cut domain.Usage) domain.Usage {
	usage := gjson.GetBytes(payload, "usage")
	out := cut
	out.PromptTokens = int(usage.Get("input_tokens").Int())
	out.CompletionTokens = int(usage.Get("output_tokens").Int())
	out.TotalTokens = int(usage.Get("total_tokens").Int())
	if out.TotalTokens == 0 {
		out.TotalTokens = out.PromptTokens + out.CompletionTokens
	}
	return out
}

// transcriptDoneUsage reads the usage on transcript.text.done.
func transcriptDoneUsage(payload []byte, cut domain.Usage) domain.Usage {
	return transcriptionUsage(gjson.GetBytes(payload, "usage"), cut)
}

// transcriptionUsage maps OpenAI's transcription usage union onto the domain
// measure: tokens for the gpt-4o family, seconds for the duration-priced
// models. An event that states neither is charged the measured upload.
func transcriptionUsage(usage gjson.Result, measured domain.Usage) domain.Usage {
	if seconds := usage.Get("seconds").Float(); seconds > 0 {
		return domain.Usage{AudioSeconds: seconds}
	}
	in, out := int(usage.Get("input_tokens").Int()), int(usage.Get("output_tokens").Int())
	if in == 0 && out == 0 {
		return measured
	}
	total := int(usage.Get("total_tokens").Int())
	if total == 0 {
		total = in + out
	}
	u := domain.Usage{PromptTokens: in, CompletionTokens: out, TotalTokens: total}
	details := usage.Get("input_token_details")
	if !details.Exists() {
		return u
	}
	return u.SplitAudioTokens(domain.AudioTokenSplit{
		InputAudio: int(details.Get("audio_tokens").Int()),
		InputText:  int(details.Get("text_tokens").Int()),
	})
}

// audioStreamHeaders are the provider response headers a caller needs: the
// content type that says what the bytes are, and the ids and limits a
// customer quotes to the vendor's support.
var audioStreamHeaders = []string{
	"Content-Type",
	"X-Request-Id",
	"Request-Id",
	"History-Item-Id",
	"Current-Concurrent-Requests",
	"Maximum-Concurrent-Requests",
	"Retry-After",
}

func forwardedAudioHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(audioStreamHeaders))
	for _, name := range audioStreamHeaders {
		if v := h.Get(name); v != "" {
			out[name] = v
		}
	}
	return out
}

// openAudioStream sends the request and returns the response once its head
// has arrived. A provider refusal comes back as an UpstreamError carrying the
// provider's own status and body, so the fallback walk classifies it and the
// caller sees the vendor's words.
func openAudioStream(ctx context.Context, client *http.Client, req *http.Request) (*http.Response, error) {
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, herr.New(ctx, domain.ErrRequestAbandoned, herr.M{
				"message": "the caller went away before the provider answered",
			})
		}
		return nil, herr.New(ctx, domain.ErrProviderConnectionFailed, herr.M{
			"reason": "the audio request failed: " + err.Error(),
			"fault":  "provider",
		})
	}
	if resp.StatusCode < 400 {
		return resp, nil
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return nil, &domain.UpstreamError{
		StatusCode: resp.StatusCode,
		Body:       raw,
		Message:    upstreamAudioErrorMessage(raw, resp.StatusCode),
		ErrorType:  gjson.GetBytes(raw, "error.type").String(),
		ErrorCode:  gjson.GetBytes(raw, "error.code").String(),
		Headers:    forwardedAudioHeaders(resp.Header),
	}
}

// upstreamAudioErrorMessage reads the message from either vendor's error
// shape: OpenAI nests it under error, ElevenLabs under detail.
func upstreamAudioErrorMessage(raw []byte, status int) string {
	for _, path := range []string{"error.message", "detail.message", "detail"} {
		if m := gjson.GetBytes(raw, path); m.Type == gjson.String && m.String() != "" {
			return m.String()
		}
	}
	return fmt.Sprintf("the provider answered HTTP %d", status)
}

// isEventStream reports whether the provider answered with SSE.
func isEventStream(h http.Header) bool {
	return strings.HasPrefix(strings.ToLower(h.Get("Content-Type")), "text/event-stream")
}

// drainAudioStream collects a stream into one response, for the callers of
// the non-streaming dispatch.
func drainAudioStream(ctx context.Context, iter domain.StreamIterator) (*domain.Response, error) {
	defer func() { _ = iter.Close() }()
	var body bytes.Buffer
	for iter.Next(ctx) {
		body.Write(iter.Chunk())
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}
	return &domain.Response{
		Body:       body.Bytes(),
		StatusCode: http.StatusOK,
		Headers:    domain.StreamHeadersOf(iter),
		Usage:      iter.Usage(),
	}, nil
}
