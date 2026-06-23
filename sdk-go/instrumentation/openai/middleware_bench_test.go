package openai

import (
	"context"
	"testing"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

const benchChatResp = `{"id":"chatcmpl-bench","object":"chat.completion","model":"gpt-4o-mini","system_fingerprint":"fp_bench","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"Hello there, how can I help you today?"}}],"usage":{"prompt_tokens":12,"completion_tokens":9,"total_tokens":21}}`

const benchChatStream = "data: {\"id\":\"c\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
	"data: {\"id\":\"c\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" there\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":2,\"total_tokens\":14}}\n\n" +
	"data: [DONE]\n\n"

func benchParams() openai.ChatCompletionNewParams {
	return openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello!"),
		},
	}
}

// benchClient builds a client over a mock transport, optionally with the tracing
// middleware. The tracer provider has no span processor, so spans are recorded
// (the realistic tracing cost) but not exported.
func benchClient(traced bool, rt *mockRoundTripper, mws ...Option) openai.Client {
	opts := []option.RequestOption{
		option.WithAPIKey("bench-key"),
		option.WithHTTPClient(newMockClient(rt)),
	}
	if traced {
		mw := append([]Option{WithTracerProvider(sdktrace.NewTracerProvider())}, mws...)
		opts = append(opts, option.WithMiddleware(Middleware("bench", mw...)))
	}
	return openai.NewClient(opts...)
}

// BenchmarkMiddlewareChatNonStreaming measures the per-call latency and
// allocations the tracing middleware adds to a non-streaming chat completion
// (the "traced" sub-benchmark) against the same call with no middleware (the
// "untraced" baseline).
func BenchmarkMiddlewareChatNonStreaming(b *testing.B) {
	for _, traced := range []bool{false, true} {
		name := map[bool]string{false: "untraced", true: "traced"}[traced]
		b.Run(name, func(b *testing.B) {
			client := benchClient(traced, &mockRoundTripper{statusCode: 200, respBody: benchChatResp})
			params := benchParams()
			ctx := context.Background()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := client.Chat.Completions.New(ctx, params); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkMiddlewareChatStreaming measures the overhead on a streamed
// completion, where the middleware reconstructs the SSE stream as the client
// reads it.
func BenchmarkMiddlewareChatStreaming(b *testing.B) {
	for _, traced := range []bool{false, true} {
		name := map[bool]string{false: "untraced", true: "traced"}[traced]
		b.Run(name, func(b *testing.B) {
			client := benchClient(traced, &mockRoundTripper{statusCode: 200, respBody: benchChatStream, contentType: "text/event-stream"})
			params := benchParams()
			ctx := context.Background()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				stream := client.Chat.Completions.NewStreaming(ctx, params)
				for stream.Next() {
					_ = stream.Current()
				}
				if err := stream.Err(); err != nil {
					b.Fatal(err)
				}
				_ = stream.Close()
			}
		})
	}
}

// BenchmarkMiddlewareCaptureModes shows the cost of capturing input/output
// content (DataCaptureAll) versus skipping it (DataCaptureNone).
func BenchmarkMiddlewareCaptureModes(b *testing.B) {
	for _, mode := range []langwatch.DataCaptureMode{langwatch.DataCaptureAll, langwatch.DataCaptureNone} {
		b.Run(string(mode), func(b *testing.B) {
			client := benchClient(true, &mockRoundTripper{statusCode: 200, respBody: benchChatResp}, WithDataCapture(mode))
			params := benchParams()
			ctx := context.Background()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := client.Chat.Completions.New(ctx, params); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
