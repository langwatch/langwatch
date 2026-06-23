package bedrock

import (
	"context"
	"reflect"
	"testing"
	"time"
	"unsafe"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// setStreamOnOutput wires a ConverseStreamEventStream onto a ConverseStreamOutput
// so output.GetStream() returns it. The SDK only sets the unexported eventStream
// field during a real call, so the test reaches it via unsafe reflection to
// exercise the genuine recordResponse -> GetStream() code path.
func setStreamOnOutput(t *testing.T, out *bedrockruntime.ConverseStreamOutput, stream *bedrockruntime.ConverseStreamEventStream) {
	t.Helper()
	field := reflect.ValueOf(out).Elem().FieldByName("eventStream")
	require.True(t, field.IsValid(), "ConverseStreamOutput.eventStream field not found")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).
		Elem().
		Set(reflect.ValueOf(stream))
}

// fakeStreamReader is a ConverseStreamOutputReader backed by a fixed event
// slice, mirroring how the SDK feeds events from the wire.
type fakeStreamReader struct {
	events []types.ConverseStreamOutput
	err    error
	closed bool
}

func (f *fakeStreamReader) Events() <-chan types.ConverseStreamOutput {
	ch := make(chan types.ConverseStreamOutput)
	go func() {
		defer close(ch)
		for _, e := range f.events {
			ch <- e
		}
	}()
	return ch
}

func (f *fakeStreamReader) Close() error {
	f.closed = true
	return nil
}

func (f *fakeStreamReader) Err() error { return f.err }

// converseStreamEvents builds a representative event sequence: message start,
// two text deltas, content-block stop, message stop, then metadata with usage.
func converseStreamEvents() []types.ConverseStreamOutput {
	return []types.ConverseStreamOutput{
		&types.ConverseStreamOutputMemberMessageStart{Value: types.MessageStartEvent{Role: types.ConversationRoleAssistant}},
		&types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
			Delta: &types.ContentBlockDeltaMemberText{Value: "Hello"},
		}},
		&types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
			Delta: &types.ContentBlockDeltaMemberText{Value: " world"},
		}},
		&types.ConverseStreamOutputMemberContentBlockStop{Value: types.ContentBlockStopEvent{}},
		&types.ConverseStreamOutputMemberMessageStop{Value: types.MessageStopEvent{StopReason: types.StopReasonEndTurn}},
		&types.ConverseStreamOutputMemberMetadata{Value: types.ConverseStreamMetadataEvent{
			Usage: &types.TokenUsage{
				InputTokens:           aws.Int32(20),
				OutputTokens:          aws.Int32(10),
				TotalTokens:           aws.Int32(30),
				CacheReadInputTokens:  aws.Int32(4),
				CacheWriteInputTokens: aws.Int32(6),
			},
			Metrics: &types.ConverseStreamMetrics{LatencyMs: aws.Int64(890)},
		}},
	}
}

func TestConverseStream_RecordsRequestThenEndsAfterDrain(t *testing.T) {
	provider, exporter := newTestProvider(t)

	input := &bedrockruntime.ConverseStreamInput{
		ModelId: aws.String("anthropic.claude-3-5-sonnet-20240620-v1:0"),
		Messages: []types.Message{{
			Role:    types.ConversationRoleUser,
			Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "stream please"}},
		}},
		InferenceConfig: &types.InferenceConfiguration{MaxTokens: aws.Int32(128)},
	}

	// Build a ConverseStreamOutput carrying a wired event-stream reader.
	stream := bedrockruntime.NewConverseStreamEventStream()
	stream.Reader = &fakeStreamReader{events: converseStreamEvents()}
	output := &bedrockruntime.ConverseStreamOutput{}
	setStreamOnOutput(t, output, stream)

	tracer := langwatch.TracerFromProvider(provider, tracerName)
	_, span := tracer.Start(context.Background(), "init")
	handler := converseStreamHandler{}
	// The middleware sets the streaming flag before dispatching to recordRequest;
	// mirror that here since this test drives the handler directly.
	span.SetGenAIRequestStream(handler.streaming())
	handler.recordRequest(span, input, langwatch.DataCaptureAll)

	ownsSpan := handler.recordResponse(context.Background(), span, output, langwatch.DataCaptureAll, time.Now())
	require.True(t, ownsSpan, "streaming handler must take ownership of the span")

	// The span must NOT be ended yet — only request attrs are recorded.
	require.NoError(t, provider.ForceFlush(t.Context()))
	require.Empty(t, exporter.GetSpans(), "span must not end until the stream is drained")

	// Drain the consumer-facing stream, as a caller would.
	var got string
	for event := range stream.Events() {
		if delta, ok := event.(*types.ConverseStreamOutputMemberContentBlockDelta); ok {
			if text, ok := delta.Value.Delta.(*types.ContentBlockDeltaMemberText); ok {
				got += text.Value
			}
		}
	}
	assert.Equal(t, "Hello world", got, "consumer still receives every event")

	span = nil // ended by the wrapper
	exported := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(exported)

	assert.Equal(t, codes.Ok, exported.Status().Code)
	// A streaming (ConverseStream) request records gen_ai.request.stream == true
	// and a TTFT measured on the first streamed event.
	assert.Equal(t, attribute.BoolValue(true), attrs[attribute.Key("gen_ai.request.stream")])
	require.Contains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"), "streaming must record TTFT")
	assert.GreaterOrEqual(t, attrs[attribute.Key("gen_ai.response.time_to_first_chunk")].AsFloat64(), 0.0)
	assert.Equal(t, attribute.StringValue("anthropic.claude-3-5-sonnet-20240620-v1:0"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.IntValue(128), attrs[semconv.GenAIRequestMaxTokensKey])

	// Accumulated output recorded as a gen_ai-native assistant message.
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "Hello world", outMsgs[0].Content)
	// Output is gen_ai-native, NOT under the langwatch.output envelope.
	_, hasLangWatchOutput := attrs[outputKey]
	assert.False(t, hasLangWatchOutput, "chat output must not be under langwatch.output")

	// Stop reason + all usage token types from the metadata event.
	assert.Equal(t, attribute.StringSliceValue([]string{"end_turn"}), attrs[semconv.GenAIResponseFinishReasonsKey])
	assert.Equal(t, attribute.IntValue(20), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(10), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(30), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	// Tokens flow solely through gen_ai.usage.*: cache read -> cached_input_tokens,
	// cache write -> cache_creation.input_tokens.
	assert.Equal(t, attribute.IntValue(4), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.IntValue(6), attrs[attribute.Key("gen_ai.usage.cache_creation.input_tokens")])
}

func TestConverseStream_EarlyClose_FinalisesSpan(t *testing.T) {
	provider, exporter := newTestProvider(t)

	reader := &fakeStreamReader{events: converseStreamEvents()}
	tracer := langwatch.TracerFromProvider(provider, tracerName)
	_, span := tracer.Start(context.Background(), "init")

	wrapped := newObservingReader(context.Background(), reader, span, langwatch.DataCaptureAll, time.Now())
	// Read a single event then abandon the stream by closing.
	<-wrapped.Events()
	require.NoError(t, wrapped.Close())

	exported := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, codes.Ok, exported.Status().Code)
	assert.True(t, reader.closed, "upstream reader should be closed")
}

// converseStreamToolUseEvents builds an event sequence where the assistant
// streams a tool_use block: a content-block start carrying the tool name + id,
// two input_json deltas, then message stop + metadata.
func converseStreamToolUseEvents() []types.ConverseStreamOutput {
	return []types.ConverseStreamOutput{
		&types.ConverseStreamOutputMemberMessageStart{Value: types.MessageStartEvent{Role: types.ConversationRoleAssistant}},
		&types.ConverseStreamOutputMemberContentBlockStart{Value: types.ContentBlockStartEvent{
			ContentBlockIndex: aws.Int32(0),
			Start: &types.ContentBlockStartMemberToolUse{Value: types.ToolUseBlockStart{
				Name:      aws.String("get_weather"),
				ToolUseId: aws.String("tool-42"),
			}},
		}},
		&types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
			ContentBlockIndex: aws.Int32(0),
			Delta:             &types.ContentBlockDeltaMemberToolUse{Value: types.ToolUseBlockDelta{Input: aws.String(`{"city":`)}},
		}},
		&types.ConverseStreamOutputMemberContentBlockDelta{Value: types.ContentBlockDeltaEvent{
			ContentBlockIndex: aws.Int32(0),
			Delta:             &types.ContentBlockDeltaMemberToolUse{Value: types.ToolUseBlockDelta{Input: aws.String(`"Paris"}`)}},
		}},
		&types.ConverseStreamOutputMemberContentBlockStop{Value: types.ContentBlockStopEvent{ContentBlockIndex: aws.Int32(0)}},
		&types.ConverseStreamOutputMemberMessageStop{Value: types.MessageStopEvent{StopReason: types.StopReasonToolUse}},
		&types.ConverseStreamOutputMemberMetadata{Value: types.ConverseStreamMetadataEvent{
			Usage: &types.TokenUsage{InputTokens: aws.Int32(12), OutputTokens: aws.Int32(7), TotalTokens: aws.Int32(19)},
		}},
	}
}

// TestConverseStream_ToolUse_RecordsToolCallOutput verifies a streamed tool_use
// block is recorded as a chat_messages output carrying the tool call (not
// discarded as empty text), mirroring the non-streaming Converse output.
func TestConverseStream_ToolUse_RecordsToolCallOutput(t *testing.T) {
	provider, exporter := newTestProvider(t)

	reader := &fakeStreamReader{events: converseStreamToolUseEvents()}
	tracer := langwatch.TracerFromProvider(provider, tracerName)
	_, span := tracer.Start(context.Background(), "init")

	wrapped := newObservingReader(context.Background(), reader, span, langwatch.DataCaptureAll, time.Now())
	for range wrapped.Events() {
	}

	exported := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(exported)

	require.Contains(t, attrs, genAIOutputKey, "tool-call response must record output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, msgs[0].Role)

	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok, "content should be rich parts, got %T", msgs[0].Content)
	require.Len(t, parts, 1, "a pure tool_use response has one tool_call part")
	toolPart, ok := parts[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "tool_call", toolPart["type"])
	assert.Equal(t, "get_weather", toolPart["toolName"])
	assert.Equal(t, "tool-42", toolPart["toolCallId"])
	assert.JSONEq(t, `{"city":"Paris"}`, toolPart["args"].(string), "streamed input_json fragments are reassembled")

	// Output is gen_ai-native, NOT under the langwatch.output envelope.
	_, hasLangWatchOutput := attrs[outputKey]
	assert.False(t, hasLangWatchOutput, "tool-call output must not be under langwatch.output")

	assert.Equal(t, attribute.StringSliceValue([]string{"tool_use"}), attrs[semconv.GenAIResponseFinishReasonsKey])
}

// TestConverseStream_CtxCancel_FinalisesSpan verifies the span is ended (and the
// pump goroutine stops) when the operation context is cancelled, even if the
// consumer abandons the stream without calling Close().
func TestConverseStream_CtxCancel_FinalisesSpan(t *testing.T) {
	provider, exporter := newTestProvider(t)

	// A reader that emits one event then blocks forever, simulating an in-flight
	// stream the consumer walks away from.
	reader := &blockingStreamReader{first: &types.ConverseStreamOutputMemberContentBlockDelta{
		Value: types.ContentBlockDeltaEvent{Delta: &types.ContentBlockDeltaMemberText{Value: "partial"}},
	}}
	tracer := langwatch.TracerFromProvider(provider, tracerName)
	_, span := tracer.Start(context.Background(), "init")

	ctx, cancel := context.WithCancel(context.Background())
	wrapped := newObservingReader(ctx, reader, span, langwatch.DataCaptureAll, time.Now())

	// Consume the first event, then abandon the stream and cancel the context.
	<-wrapped.Events()
	cancel()

	// The pump closes its consumer channel after finalising the span, so draining
	// to close is the synchronization point that proves both happened (and that
	// the goroutine exited rather than leaking).
	for range wrapped.Events() {
	}

	// The span must be ended by ctx cancellation without Close().
	exported := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(exported)
	// The partial text observed before cancellation is still recorded as a
	// gen_ai-native assistant message.
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "partial", outMsgs[0].Content)
}

// blockingStreamReader emits a single event then leaves the channel open and
// idle forever, modelling a long-lived stream abandoned mid-flight.
type blockingStreamReader struct {
	first  types.ConverseStreamOutput
	closed bool
}

func (b *blockingStreamReader) Events() <-chan types.ConverseStreamOutput {
	ch := make(chan types.ConverseStreamOutput)
	go func() {
		ch <- b.first
		// Never close: model an in-flight upstream the consumer abandons.
		select {}
	}()
	return ch
}

func (b *blockingStreamReader) Close() error { b.closed = true; return nil }
func (b *blockingStreamReader) Err() error   { return nil }

func TestConverseStream_DataCaptureOutputOnly_KeepsOutputDropsInput(t *testing.T) {
	provider, exporter := newTestProvider(t)

	input := &bedrockruntime.ConverseStreamInput{
		ModelId:  aws.String("anthropic.claude-3-haiku-20240307-v1:0"),
		Messages: []types.Message{{Role: types.ConversationRoleUser, Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "in"}}}},
	}
	reader := &fakeStreamReader{events: converseStreamEvents()}

	tracer := langwatch.TracerFromProvider(provider, tracerName)
	_, span := tracer.Start(context.Background(), "init")
	handler := converseStreamHandler{}
	handler.recordRequest(span, input, langwatch.DataCaptureOutput)
	wrapped := newObservingReader(context.Background(), reader, span, langwatch.DataCaptureOutput, time.Now())
	for range wrapped.Events() {
	}

	exported := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(exported)
	_, hasInput := attrs[genAIInputKey]
	_, hasOutput := attrs[genAIOutputKey]
	assert.False(t, hasInput, "input stripped under output-only capture")
	assert.True(t, hasOutput, "output kept under output-only capture")
}
