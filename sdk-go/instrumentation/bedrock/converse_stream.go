package bedrock

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"go.opentelemetry.io/otel/codes"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// converseStreamHandler instruments the streaming Converse operation. Request
// attributes are recorded at start (sharing converseHandler's request mapping);
// the response side wraps the typed event-stream reader so the span ends only
// after the stream is fully consumed, accumulating the assistant message (text
// and tool calls) and the final metadata Usage along the way.
//
// IMPORTANT: the caller MUST Close() the returned stream (the AWS SDK does this
// when the *ConverseStreamEventStream is closed). The span is otherwise ended
// when the upstream channel drains or the operation's context is cancelled; a
// consumer that abandons the stream without Close() and with a non-cancellable
// context would leave the span open. Always defer Close on the stream.
type converseStreamHandler struct{}

func (converseStreamHandler) operation() string { return "chat" }
func (converseStreamHandler) streaming() bool   { return true }

func (converseStreamHandler) recordRequest(span *langwatch.Span, params any, capture langwatch.DataCaptureMode) {
	input, ok := params.(*bedrockruntimeConverseStreamInput)
	if !ok {
		return
	}
	recordConverseRequest(span, converseRequest{
		modelID:         derefString(input.ModelId),
		messages:        input.Messages,
		system:          input.System,
		inferenceConfig: input.InferenceConfig,
		toolConfig:      input.ToolConfig,
	}, capture)
}

func (converseStreamHandler) recordResponse(ctx context.Context, span *langwatch.Span, result any, capture langwatch.DataCaptureMode, start time.Time) bool {
	output, ok := result.(*bedrockruntimeConverseStreamOutput)
	if !ok {
		return false
	}
	stream := output.GetStream()
	if stream == nil || stream.Reader == nil {
		// No stream to observe (e.g. a mock that did not wire a reader): nothing
		// more to record; let the caller end the span.
		return false
	}

	// Wrap the event-stream reader so we observe events as the SDK drains them,
	// then end the span when the stream closes, Close() is called, or the
	// operation context is cancelled. Ownership of the span transfers to the
	// wrapper.
	stream.Reader = newObservingReader(ctx, stream.Reader, span, capture, start)
	return true
}

// observingReader decorates a ConverseStreamOutputReader, forwarding its events
// to the consumer while accumulating the output message and final usage so the
// span can be completed once the stream is fully drained, the reader is closed,
// or the operation context is cancelled.
type observingReader struct {
	upstream streamReader
	span     *langwatch.Span
	capture  langwatch.DataCaptureMode
	start    time.Time

	events       chan types.ConverseStreamOutput
	done         chan struct{}
	closeDone    sync.Once
	once         sync.Once
	acc          streamAccumulator
	accLock      sync.Mutex
	ttftRecorded bool
}

// streamReader is the subset of ConverseStreamOutputReader the wrapper depends
// on; declaring it locally keeps the wrapper testable without the AWS reader.
type streamReader interface {
	Events() <-chan types.ConverseStreamOutput
	Close() error
	Err() error
}

// streamAccumulator collects the streamed assistant output and final usage.
type streamAccumulator struct {
	output     strings.Builder
	stopReason string
	usage      *types.TokenUsage
	// toolCalls accumulates streamed tool_use blocks keyed by their content-block
	// index; toolCallOrder preserves first-seen order for deterministic output.
	toolCalls     map[int32]*streamToolUse
	toolCallOrder []int32
}

// streamToolUse accumulates the fragments of a single streamed tool_use block.
// The name/id arrive on ContentBlockStart; the JSON input is streamed as
// ToolUseBlockDelta.Input fragments.
type streamToolUse struct {
	name string
	id   string
	args strings.Builder
}

// newObservingReader starts a forwarding goroutine and returns the wrapper. The
// goroutine observes every event, forwards it to the consumer-facing channel,
// and finalises the span when the upstream channel closes, Close() is called, or
// ctx is cancelled.
func newObservingReader(ctx context.Context, upstream streamReader, span *langwatch.Span, capture langwatch.DataCaptureMode, start time.Time) *observingReader {
	r := &observingReader{
		upstream: upstream,
		span:     span,
		capture:  capture,
		start:    start,
		events:   make(chan types.ConverseStreamOutput),
		done:     make(chan struct{}),
	}
	go r.pump(ctx)
	return r
}

// pump forwards upstream events to the consumer while observing each one, then
// finalises the span when the upstream stream ends. The forward send aborts if
// the reader is closed early or the operation context is cancelled, so the
// goroutine never leaks and the span is always ended.
func (r *observingReader) pump(ctx context.Context) {
	defer close(r.events)
	upstream := r.upstream.Events()
	for {
		select {
		case event, ok := <-upstream:
			if !ok {
				// Upstream drained: record what we have and end the span.
				r.finish()
				return
			}
			r.observe(event)
			select {
			case r.events <- event:
			case <-r.done:
				r.finish()
				return
			case <-ctx.Done():
				r.finish()
				return
			}
		case <-r.done:
			r.finish()
			return
		case <-ctx.Done():
			// The operation context was cancelled (e.g. the consumer abandoned the
			// stream without Close and the request was cancelled): end the span so
			// neither it nor this goroutine leaks.
			r.finish()
			return
		}
	}
}

// observe accumulates the relevant fields from a single stream event.
func (r *observingReader) observe(event types.ConverseStreamOutput) {
	r.accLock.Lock()
	defer r.accLock.Unlock()
	// The first observed event marks time-to-first-chunk (TTFT): the latency from
	// request start to the first streamed event, in seconds. Recorded once.
	if !r.ttftRecorded {
		r.ttftRecorded = true
		r.span.SetGenAITimeToFirstChunk(time.Since(r.start).Seconds())
	}
	switch e := event.(type) {
	case *types.ConverseStreamOutputMemberContentBlockStart:
		if start, ok := e.Value.Start.(*types.ContentBlockStartMemberToolUse); ok {
			tc := r.acc.toolUseAt(blockIndex(e.Value.ContentBlockIndex))
			tc.name = derefString(start.Value.Name)
			tc.id = derefString(start.Value.ToolUseId)
		}
	case *types.ConverseStreamOutputMemberContentBlockDelta:
		switch d := e.Value.Delta.(type) {
		case *types.ContentBlockDeltaMemberText:
			r.acc.output.WriteString(d.Value)
		case *types.ContentBlockDeltaMemberToolUse:
			r.acc.toolUseAt(blockIndex(e.Value.ContentBlockIndex)).args.WriteString(derefString(d.Value.Input))
		}
	case *types.ConverseStreamOutputMemberMessageStop:
		r.acc.stopReason = string(e.Value.StopReason)
	case *types.ConverseStreamOutputMemberMetadata:
		r.acc.usage = e.Value.Usage
	}
}

// toolUseAt returns the accumulator for the streamed tool_use block at index,
// creating it (and remembering its order) on first sight.
func (a *streamAccumulator) toolUseAt(index int32) *streamToolUse {
	if a.toolCalls == nil {
		a.toolCalls = make(map[int32]*streamToolUse)
	}
	tc, ok := a.toolCalls[index]
	if !ok {
		tc = &streamToolUse{}
		a.toolCalls[index] = tc
		a.toolCallOrder = append(a.toolCallOrder, index)
	}
	return tc
}

// assembledParts renders the accumulated output into LangWatch rich content: the
// visible text (if any) followed by the tool_use blocks as tool_call parts, in
// first-seen order. hasToolUse reports whether any tool_use block was seen.
func (a *streamAccumulator) assembledParts() (parts []langwatch.ChatRichContent, hasToolUse bool) {
	if a.output.Len() > 0 {
		parts = append(parts, langwatch.TextPart(a.output.String()))
	}
	for _, index := range a.toolCallOrder {
		tc := a.toolCalls[index]
		hasToolUse = true
		parts = append(parts, langwatch.ChatRichContent{
			Type:       langwatch.ChatContentTypeToolCall,
			ToolName:   tc.name,
			ToolCallID: tc.id,
			Args:       tc.args.String(),
		})
	}
	return parts, hasToolUse
}

// finish records the accumulated stream results on the span and ends it.
func (r *observingReader) finish() {
	r.once.Do(func() {
		r.accLock.Lock()
		acc := &r.acc
		r.accLock.Unlock()

		if acc.stopReason != "" {
			r.span.SetGenAIResponseFinishReasons(acc.stopReason)
		}
		recordTokenUsage(r.span, acc.usage)
		if r.capture.CaptureOutput() {
			// Record structured chat messages when tool_use blocks were streamed
			// (the common agent case), so they are not discarded; otherwise keep
			// the plain-text path for pure-text responses.
			if parts, hasToolUse := acc.assembledParts(); hasToolUse {
				r.span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
					Role:    langwatch.ChatRoleAssistant,
					Content: parts,
				}})
			} else if acc.output.Len() > 0 {
				r.span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, acc.output.String())})
			}
		}
		if err := r.upstream.Err(); err != nil {
			r.span.SetStatus(codes.Error, err.Error())
			r.span.RecordError(err)
		} else {
			r.span.SetStatus(codes.Ok, "")
		}
		r.span.End()
	})
}

// Events returns the consumer-facing event channel.
func (r *observingReader) Events() <-chan types.ConverseStreamOutput {
	return r.events
}

// Err proxies the upstream reader's terminal error.
func (r *observingReader) Err() error {
	return r.upstream.Err()
}

// Close finalises the span (if the stream was abandoned early) and closes the
// upstream reader. Signalling done unblocks a pump goroutine parked on a forward
// send so it can finalise and exit.
func (r *observingReader) Close() error {
	r.signalDone()
	err := r.upstream.Close()
	r.finish()
	return err
}

// signalDone closes the done channel exactly once.
func (r *observingReader) signalDone() {
	r.closeDone.Do(func() { close(r.done) })
}

// blockIndex dereferences a content-block index pointer, defaulting to 0.
func blockIndex(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}
