package providers

import (
	"context"
	"net/http"

	"github.com/bytedance/sonic"
	bfanthropic "github.com/maximhq/bifrost/core/providers/anthropic"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// anthropicTranslatedStreamIterator drives Bifrost's Responses stream and emits
// Anthropic SSE frames. It is a RawFramer: the frames it yields are already
// complete `event:/data:` pairs, so writeSSE forwards them verbatim and adds
// neither a `data: [DONE]` trailer (Anthropic has no such sentinel) nor the
// usage warning frame.
type anthropicTranslatedStreamIterator struct {
	ch    chan *bfschemas.BifrostStreamChunk
	bfCtx *bfschemas.BifrostContext

	framer  *anthropicStreamFramer
	logger  *zap.Logger
	pending [][]byte
	current []byte

	usage domain.Usage
	err   error
	done  bool
	// drained marks that the upstream channel closed and the terminal frames
	// have been queued, so Next stops pulling from a closed channel.
	drained bool
}

func (it *anthropicTranslatedStreamIterator) RawFraming() bool { return true }
func (it *anthropicTranslatedStreamIterator) Chunk() []byte    { return it.current }
func (it *anthropicTranslatedStreamIterator) Usage() domain.Usage {
	return it.usage
}
func (it *anthropicTranslatedStreamIterator) Err() error { return it.err }

// Close releases the Bifrost producer. Next stops reading as soon as the stream
// terminates, on cancellation, on a provider error, or once the terminal frames
// are queued, but the producer goroutine may still be parked mid-send. Leaving
// it blocked on a channel nobody reads leaks a goroutine per abandoned request,
// so the remainder is drained until the producer closes it. The drain runs in
// the background because Close is on the request path and must not wait on an
// upstream that is still streaming.
func (it *anthropicTranslatedStreamIterator) Close() error {
	if it.ch == nil {
		return nil
	}
	ch := it.ch
	it.ch = nil
	go func() {
		for range ch { //nolint:revive // draining to release the producer
		}
	}()
	return nil
}

// emit queues the wire bytes for a batch of events.
func (it *anthropicTranslatedStreamIterator) emit(events []*bfanthropic.AnthropicStreamEvent) {
	for _, ev := range events {
		frame, err := anthropicSSEFrame(ev)
		if err != nil {
			// Dropping a frame silently is how a client ends up waiting
			// forever with nothing in the logs to explain it, so record the
			// event type. The type alone identifies the failure and carries
			// no request payload.
			if it.logger != nil {
				it.logger.Error("anthropic stream frame dropped: marshal failed",
					zap.String("event_type", string(ev.Type)),
					zap.Error(err))
			}
			continue
		}
		if len(frame) > 0 {
			it.pending = append(it.pending, frame)
		}
	}
}

// anthropicStopReasonForIncomplete maps a Responses `incomplete` terminal event
// onto the Anthropic stop reason its detail actually describes.
func anthropicStopReasonForIncomplete(resp *bfschemas.BifrostResponsesStreamResponse) bfanthropic.AnthropicStopReason {
	reason := ""
	if resp != nil && resp.Response != nil && resp.Response.IncompleteDetails != nil {
		reason = resp.Response.IncompleteDetails.Reason
	}
	switch reason {
	case "max_output_tokens", "max_tokens", "":
		// Empty means the provider did not say; truncation is the
		// overwhelmingly common cause and the one the chat-completions
		// fallback always reports.
		return bfanthropic.AnthropicStopReasonMaxTokens
	case "content_filter":
		return bfanthropic.AnthropicStopReasonRefusal
	default:
		return bfanthropic.AnthropicStopReasonRefusal
	}
}
func (it *anthropicTranslatedStreamIterator) Next(ctx context.Context) bool {
	for {
		if len(it.pending) > 0 {
			it.current = it.pending[0]
			it.pending = it.pending[1:]
			return true
		}
		if it.done {
			return false
		}
		if it.drained {
			it.done = true
			return false
		}

		select {
		case <-ctx.Done():
			// The client went away, so there is nobody left to receive a
			// terminal frame. Report the cancellation and stop.
			it.err = ctx.Err()
			it.done = true
			return false

		case chunk, ok := <-it.ch:
			if !ok {
				// Upstream closed without a terminal event. finish() supplies
				// the message_delta + message_stop the client is waiting for
				// instead of letting the connection stall.
				it.drained = true
				it.emit(it.framer.finish())
				continue
			}
			if chunk.BifrostError != nil {
				it.emit(it.framer.closeAllBlocks(nil))
				it.err = anthropicErrorFromBifrost(chunk.BifrostError)
				it.drained = true
				continue
			}
			resp := chunk.BifrostResponsesStreamResponse
			if resp == nil {
				continue
			}
			it.consume(resp)
		}
	}
}

// consume converts one Bifrost Responses stream event into framed Anthropic
// events and folds its usage into the running totals.
func (it *anthropicTranslatedStreamIterator) consume(resp *bfschemas.BifrostResponsesStreamResponse) {
	if resp.Response != nil && resp.Response.Usage != nil {
		u := extractResponsesUsage(resp.Response)
		if u.PromptTokens > 0 {
			it.usage.PromptTokens = u.PromptTokens
		}
		if u.CompletionTokens > 0 {
			it.usage.CompletionTokens = u.CompletionTokens
		}
		if u.CacheReadTokens > 0 {
			it.usage.CacheReadTokens = u.CacheReadTokens
		}
		if u.CacheCreationTokens > 0 {
			it.usage.CacheCreationTokens = u.CacheCreationTokens
		}
		if u.TotalTokens > 0 {
			it.usage.TotalTokens = u.TotalTokens
		} else {
			it.usage.TotalTokens = it.usage.PromptTokens + it.usage.CompletionTokens
		}
		it.framer.setUsage(bfanthropic.ConvertBifrostUsageToAnthropicUsage(resp.Response.Usage))
	}

	// Terminal events the vendored converter has no case for. Left to it they
	// convert to nothing, and the client waits for a message_stop that never
	// comes. Map them onto a stop reason and close the message here.
	switch resp.Type {
	case bfschemas.ResponsesStreamResponseTypeIncomplete:
		// `incomplete` covers more than truncation. Only a token-limit reason
		// is max_tokens; a content filter stopped the turn for a different
		// cause and reporting it as max_tokens would invite the client to
		// continue a turn the provider refused.
		it.framer.setStopReason(anthropicStopReasonForIncomplete(resp))
		it.emit(it.framer.finish())
		return
	case bfschemas.ResponsesStreamResponseTypeFailed:
		msg := "the provider failed the request"
		if resp.Message != nil && *resp.Message != "" {
			msg = *resp.Message
		}
		it.emit(it.framer.closeAllBlocks(nil))
		it.err = anthropicUpstreamError(http.StatusBadGateway, msg)
		it.drained = true
		return
	default:
		// Everything else is a mid-stream event the converter below knows how
		// to map, or one it deliberately ignores.
	}

	for _, ev := range bfanthropic.ToAnthropicResponsesStreamResponse(it.bfCtx, resp) {
		it.emit(it.framer.push(ev))
	}
}

// anthropicSSEFrame serializes one Anthropic stream event into SSE wire bytes.
// Anthropic names the event on the `event:` line as well as inside the JSON
// payload, and clients read the former to pick a decoder.
func anthropicSSEFrame(ev *bfanthropic.AnthropicStreamEvent) ([]byte, error) {
	if ev == nil || ev.Type == "" {
		return nil, nil
	}
	payload, err := sonic.Marshal(ev)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 0, len(payload)+len(ev.Type)+16)
	out = append(out, "event: "...)
	out = append(out, ev.Type...)
	out = append(out, "\ndata: "...)
	out = append(out, payload...)
	out = append(out, "\n\n"...)
	return out, nil
}
