package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openai "github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
	oteltrace "go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"go.opentelemetry.io/otel"
)

// mockRoundTripper allows mocking HTTP responses.
type mockRoundTripper struct {
	roundTrip func(req *http.Request) (*http.Response, error)
}

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	// Pass the request through the user-defined roundTrip function first
	resp, err := m.roundTrip(req)
	if err != nil {
		return resp, err
	}

	isStreamingReq := false
	if req.URL.Path == "/v1/chat/completions" && req.Body != nil {
		bodyBytes, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewBuffer(bodyBytes)) // Restore body
		var reqData jsonData
		if json.Unmarshal(bodyBytes, &reqData) == nil {
			if streamVal, ok := reqData["stream"].(bool); ok && streamVal {
				isStreamingReq = true
			}
		}
	}

	if isStreamingReq && resp.StatusCode < 300 && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		span := oteltrace.SpanFromContext(req.Context())
		if span.IsRecording() {
			streamBodyBytes, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()

			parseMockStreamAndSetAttributes(bytes.NewReader(streamBodyBytes), span, true)

			resp.Body = io.NopCloser(bytes.NewReader(streamBodyBytes))
		}
	}
	// --- End Intercept ---

	return resp, nil
}

// parseMockStreamAndSetAttributes parses the mock stream for testing.
func parseMockStreamAndSetAttributes(streamData io.Reader, span oteltrace.Span, recordOutput bool) {
	scanner := bufio.NewScanner(streamData)
	var outputTokens int
	var outputContent bytes.Buffer
	firstChunkProcessed := false
	usageTokensFound := false

	for scanner.Scan() {
		line := scanner.Bytes()
		if bytes.HasPrefix(line, []byte("data:")) {
			data := bytes.TrimPrefix(line, []byte("data:"))
			data = bytes.TrimSpace(data)

			if string(data) == "[DONE]" {
				break
			}

			var chunkData jsonData
			if err := json.Unmarshal(data, &chunkData); err == nil {
				if !firstChunkProcessed {
					if id, ok := getString(chunkData, "id"); ok {
						span.SetAttributes(semconv.GenAIResponseIDKey.String(id))
					}
					if model, ok := getString(chunkData, "model"); ok {
						span.SetAttributes(semconv.GenAIResponseModelKey.String(model))
					}
					if sysFingerprint, ok := getString(chunkData, "system_fingerprint"); ok {
						span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprintKey.String(sysFingerprint))
					}
					firstChunkProcessed = true
				}

				if choices, ok := chunkData["choices"].([]interface{}); ok {
					currentChunkFinishReasons := []string{}
					for _, choiceRaw := range choices {
						if choice, choiceOk := choiceRaw.(jsonData); choiceOk {
							if delta, deltaOk := choice["delta"].(jsonData); deltaOk {
								if content, contentOk := getString(delta, "content"); contentOk && content != "" {
									if !usageTokensFound {
										outputTokens++
									}
									if recordOutput {
										outputContent.WriteString(content)
									}
								}
							}
							if reason, ok := getString(choice, "finish_reason"); ok && reason != "" {
								currentChunkFinishReasons = append(currentChunkFinishReasons, reason)
							}
						}
					}
					if len(currentChunkFinishReasons) > 0 {
						span.SetAttributes(semconv.GenAIResponseFinishReasonsKey.StringSlice(currentChunkFinishReasons))
					}
				}

				if usage, usageOk := chunkData["usage"].(jsonData); usageOk {
					if completionTokens, ok := getInt(usage, "completion_tokens"); ok {
						outputTokens = completionTokens
						span.SetAttributes(semconv.GenAIUsageOutputTokensKey.Int(outputTokens))
						usageTokensFound = true
					}
					if promptTokens, ok := getInt(usage, "prompt_tokens"); ok {
						span.SetAttributes(semconv.GenAIUsageInputTokensKey.Int(promptTokens))
					}
				}
			} else {
				span.AddEvent("Failed to parse mock stream chunk JSON", oteltrace.WithAttributes(attribute.String("error", err.Error()), attribute.String("chunk_data", string(data))))
			}
		}
	}

	if err := scanner.Err(); err != nil {
		span.AddEvent("Error scanning mock stream data", oteltrace.WithAttributes(attribute.String("error", err.Error())))
	}

	if !usageTokensFound {
		span.SetAttributes(semconv.GenAIUsageOutputTokensKey.Int(outputTokens))
	}
	if recordOutput && outputContent.Len() > 0 {
		span.SetAttributes(langwatch.AttributeLangWatchOutput.String(outputContent.String()))
	}
}

// newMockHTTPClient creates a mock HTTP client.
func newMockHTTPClient(rt func(req *http.Request) (*http.Response, error)) *http.Client {
	return &http.Client{
		Transport: &mockRoundTripper{roundTrip: rt},
	}
}

// findAttr finds an attribute in a slice.
func findAttr(attrs []attribute.KeyValue, key attribute.Key) (attribute.Value, bool) {
	for _, attr := range attrs {
		if attr.Key == key {
			return attr.Value, true
		}
	}
	return attribute.Value{}, false
}

func TestMiddlewareIntegration(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	// Set the global tracer provider for the test
	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(originalTracerProvider) // Restore original

	completionModelID := openai.ChatModelGPT4oMini
	completionReqBody := `{"model":"` + string(completionModelID) + `","messages":[{"role":"user","content":"ping"}],"max_tokens":5,"temperature":0.7,"top_p":0.9,"frequency_penalty":0.1,"presence_penalty":0.2}`
	completionRespBody := `{"id":"cmpl-xyz","object":"chat.completion","created":1700000000,"model":"gpt-test-resp","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3},"system_fingerprint":"fp_test_value"}`
	streamReqBody := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"count"}],"stream":true}`
	streamRespBody := `data: {"id":"cmpl-str","object":"chat.completion.chunk","created":1700000100,"model":"gpt-stream-resp","system_fingerprint":"fp_stream_test","choices":[{"index":0,"delta":{"content":"one"},"finish_reason":null}]}

data: {"id":"cmpl-str","object":"chat.completion.chunk","created":1700000100,"model":"gpt-stream-resp","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

`
	errorReqBody := `{"model":"gpt-4o-mini","messages":[]}`

	tests := []struct {
		name               string
		endpointPath       string
		openaiOp           func(client openai.Client)
		mockResponseStatus int
		mockResponseBody   string
		requestBody        string
		middlewareOpts     []Option
		expectedSpanName   string
		expectedAttrs      map[attribute.Key]attribute.Value
		expectedStatusCode codes.Code
	}{
		{
			name:         "Chat Completion Success No Recording",
			endpointPath: "/v1/chat/completions",
			openaiOp: func(client openai.Client) {
				_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
					Model: completionModelID,
					Messages: []openai.ChatCompletionMessageParamUnion{
						openai.UserMessage("ping"),
					},
					MaxTokens:        openai.Opt(int64(5)),
					Temperature:      openai.Opt(float64(0.7)),
					TopP:             openai.Opt(float64(0.9)),
					FrequencyPenalty: openai.Opt(float64(0.1)),
					PresencePenalty:  openai.Opt(float64(0.2)),
				})
				require.NoError(t, err)
			},
			mockResponseStatus: http.StatusOK,
			mockResponseBody:   completionRespBody,
			requestBody:        completionReqBody,
			middlewareOpts:     []Option{WithTracerProvider(provider)},
			expectedSpanName:   fmt.Sprintf("openai.completions.%s", completionModelID),
			expectedAttrs: map[attribute.Key]attribute.Value{
				semconv.HTTPRequestMethodKey:          attribute.StringValue("POST"),
				semconv.URLPathKey:                    attribute.StringValue("/v1/chat/completions"),
				semconv.GenAISystemKey:                semconv.GenAISystemOpenai.Value,
				semconv.GenAIOperationNameKey:         attribute.StringValue("chat"),
				semconv.GenAIRequestModelKey:          attribute.StringValue(string(completionModelID)),
				semconv.GenAIRequestMaxTokensKey:      attribute.IntValue(5),
				semconv.GenAIResponseIDKey:            attribute.StringValue("cmpl-xyz"),
				semconv.GenAIResponseModelKey:         attribute.StringValue("gpt-test-resp"),
				semconv.GenAIUsageInputTokensKey:      attribute.IntValue(2),
				semconv.GenAIUsageOutputTokensKey:     attribute.IntValue(1),
				semconv.GenAIResponseFinishReasonsKey: attribute.StringSliceValue([]string{"stop"}),
				semconv.HTTPResponseStatusCodeKey:     attribute.IntValue(http.StatusOK),
			},
			expectedStatusCode: codes.Ok,
		},
		{
			name:         "Chat Completion Success With Recording",
			endpointPath: "/v1/chat/completions",
			openaiOp: func(client openai.Client) {
				_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
					Model: completionModelID,
					Messages: []openai.ChatCompletionMessageParamUnion{
						openai.UserMessage("ping"),
					},
					MaxTokens:        openai.Opt(int64(5)),
					Temperature:      openai.Opt(float64(0.7)),
					TopP:             openai.Opt(float64(0.9)),
					FrequencyPenalty: openai.Opt(float64(0.1)),
					PresencePenalty:  openai.Opt(float64(0.2)),
				})
				_ = err // We are not asserting the error here as the mock will always succeed
			},
			mockResponseStatus: http.StatusOK,
			mockResponseBody:   completionRespBody,
			requestBody:        completionReqBody,
			middlewareOpts: []Option{
				WithTracerProvider(provider),
				WithCaptureInput(),
				WithCaptureOutput(),
			},
			expectedSpanName: fmt.Sprintf("openai.completions.%s", completionModelID),
			expectedAttrs: map[attribute.Key]attribute.Value{
				semconv.HTTPRequestMethodKey:                    attribute.StringValue("POST"),
				semconv.URLPathKey:                              attribute.StringValue("/v1/chat/completions"),
				semconv.GenAISystemKey:                          semconv.GenAISystemOpenai.Value,
				semconv.GenAIOperationNameKey:                   attribute.StringValue("chat"),
				semconv.GenAIRequestModelKey:                    attribute.StringValue(string(completionModelID)),
				semconv.GenAIRequestTemperatureKey:              attribute.Float64Value(0.7),
				semconv.GenAIRequestTopPKey:                     attribute.Float64Value(0.9),
				semconv.GenAIRequestFrequencyPenaltyKey:         attribute.Float64Value(0.1),
				semconv.GenAIRequestPresencePenaltyKey:          attribute.Float64Value(0.2),
				semconv.GenAIResponseIDKey:                      attribute.StringValue("cmpl-xyz"),
				semconv.GenAIResponseModelKey:                   attribute.StringValue("gpt-test-resp"),
				semconv.GenAIOpenaiResponseSystemFingerprintKey: attribute.StringValue("fp_test_value"),
				semconv.GenAIUsageInputTokensKey:                attribute.IntValue(2),
				semconv.GenAIUsageOutputTokensKey:               attribute.IntValue(1),
				semconv.GenAIResponseFinishReasonsKey:           attribute.StringSliceValue([]string{"stop"}),
				semconv.HTTPResponseStatusCodeKey:               attribute.IntValue(http.StatusOK),
			},
			expectedStatusCode: codes.Ok,
		},
		{
			name:         "Chat Completion Stream Success With Recording",
			endpointPath: "/v1/chat/completions",
			openaiOp: func(client openai.Client) {
				// Call NewStreaming, which returns only the stream object
				// No Stream: true is needed in params for this method
				stream := client.Chat.Completions.NewStreaming(context.Background(), openai.ChatCompletionNewParams{
					Model: completionModelID,
					Messages: []openai.ChatCompletionMessageParamUnion{
						openai.UserMessage("count"),
					},
					// Stream: true), // REMOVED - Not a field in params, implied by NewStreaming
				})
				// Error checking comes after consuming the stream via stream.Err()
				require.NotNil(t, stream, "Expected a non-nil stream object")

				// Consume the stream using Next/Current/Err pattern
				for stream.Next() {
					_ = stream.Current() // Discard the chunk, we just need to read it for the test
				}
				// Check for stream errors *after* consuming
				require.NoError(t, stream.Err(), "Error consuming stream")
			},
			mockResponseStatus: http.StatusOK,
			mockResponseBody:   streamRespBody,
			requestBody:        streamReqBody,
			middlewareOpts: []Option{
				WithTracerProvider(provider),
				WithCaptureInput(),
				WithCaptureOutput(),
			},
			expectedSpanName: fmt.Sprintf("openai.completions.%s", completionModelID),
			expectedAttrs: map[attribute.Key]attribute.Value{
				semconv.HTTPRequestMethodKey:                    attribute.StringValue("POST"),
				semconv.URLPathKey:                              attribute.StringValue("/v1/chat/completions"),
				semconv.GenAISystemKey:                          semconv.GenAISystemOpenai.Value,
				semconv.GenAIOperationNameKey:                   attribute.StringValue("chat"),
				semconv.GenAIRequestModelKey:                    attribute.StringValue(string(completionModelID)),
				langwatch.AttributeLangWatchStreaming:           attribute.BoolValue(true),
				semconv.GenAIResponseIDKey:                      attribute.StringValue("cmpl-str"),
				semconv.GenAIResponseModelKey:                   attribute.StringValue("gpt-stream-resp"),
				semconv.GenAIOpenaiResponseSystemFingerprintKey: attribute.StringValue("fp_stream_test"),
				semconv.GenAIResponseFinishReasonsKey:           attribute.StringSliceValue([]string{"stop"}),
				semconv.HTTPResponseStatusCodeKey:               attribute.IntValue(http.StatusOK),
			},
			expectedStatusCode: codes.Ok,
		},
		{
			name:         "API Error",
			endpointPath: "/v1/chat/completions",
			openaiOp: func(client openai.Client) {
				_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
					Model:    completionModelID,
					Messages: []openai.ChatCompletionMessageParamUnion{},
				})
				require.Error(t, err)
			},
			mockResponseStatus: http.StatusBadRequest,
			mockResponseBody:   errorReqBody,
			requestBody:        errorReqBody,
			middlewareOpts:     []Option{WithTracerProvider(provider)},
			expectedSpanName:   fmt.Sprintf("openai.completions.%s", completionModelID),
			expectedAttrs: map[attribute.Key]attribute.Value{
				semconv.HTTPRequestMethodKey:      attribute.StringValue("POST"),
				semconv.URLPathKey:                attribute.StringValue("/v1/chat/completions"),
				semconv.GenAISystemKey:            semconv.GenAISystemOpenai.Value,
				semconv.GenAIOperationNameKey:     attribute.StringValue("chat"),
				semconv.GenAIRequestModelKey:      attribute.StringValue(string(completionModelID)),
				semconv.HTTPResponseStatusCodeKey: attribute.IntValue(http.StatusBadRequest),
			},
			expectedStatusCode: codes.Error,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			exporter := tracetest.NewInMemoryExporter()
			sp := sdktrace.NewSimpleSpanProcessor(exporter)
			provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
			defer func() { // Ensure cleanup even if test panics
				_ = sp.Shutdown(context.Background())
				_ = exporter.Shutdown(context.Background())
			}()

			// Set the global tracer provider to the test-local one for this sub-test
			originalTestGlobalProvider := otel.GetTracerProvider()
			otel.SetTracerProvider(provider)
			defer otel.SetTracerProvider(originalTestGlobalProvider)

			currentMiddlewareOpts := make([]Option, len(tt.middlewareOpts))
			copy(currentMiddlewareOpts, tt.middlewareOpts)
			for i, opt := range currentMiddlewareOpts {
				if _, ok := opt.(optionFunc); ok { // Check if it's one of our options
					dummyConf := config{}
					opt.apply(&dummyConf)
					if dummyConf.tracerProvider != nil { // Is it the WithTracerProvider option?
						currentMiddlewareOpts[i] = WithTracerProvider(provider)
						break
					}
				}
			}

			mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
				assert.Equal(t, tt.endpointPath, req.URL.Path)
				if tt.requestBody != "" && req.Body != nil {
					bodyBytes, _ := io.ReadAll(req.Body)
					req.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
					assert.JSONEq(t, tt.requestBody, string(bodyBytes))
				}
				header := http.Header{}
				if strings.Contains(tt.mockResponseBody, "data: [DONE]") {
					header.Set("Content-Type", "text/event-stream")
				} else {
					header.Set("Content-Type", "application/json")
				}
				return &http.Response{
					StatusCode: tt.mockResponseStatus,
					Body:       io.NopCloser(strings.NewReader(tt.mockResponseBody)),
					Header:     header,
				}, nil
			})

			client := openai.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(mockClient),
				option.WithMiddleware(Middleware("test-client", currentMiddlewareOpts...)),
			)

			tt.openaiOp(client)

			spans := exporter.GetSpans()
			require.Len(t, spans, 1, "Expected exactly one span to be created")

			for _, recordedSpan := range spans {
				assert.Equal(t, tt.expectedSpanName, recordedSpan.Name)
				assert.Equal(t, tt.expectedStatusCode, recordedSpan.Status.Code)

				recordedAttrs := recordedSpan.Attributes

				for key, expectedValue := range tt.expectedAttrs {
					actualValue, ok := findAttr(recordedAttrs, key)
					assert.Truef(t, ok, "Expected attribute '%s' not found", key)
					if ok {
						assert.Equalf(t, expectedValue, actualValue, "Attribute '%s' mismatch", key)
					}
				}

				shouldRecordInput := hasOption(tt.middlewareOpts, WithCaptureInput())
				shouldRecordOutput := hasOption(tt.middlewareOpts, WithCaptureOutput())

				// Helper struct for parsing langwatch attributes
				type langwatchAttrValue struct {
					Type  string          `json:"type"`
					Value json.RawMessage `json:"value"`
				}

				inputAttrValue, inputPresent := findAttr(recordedAttrs, langwatch.AttributeLangWatchInput)
				assert.Equal(t, shouldRecordInput, inputPresent, "Mismatch in presence of input value attribute")
				if shouldRecordInput && inputPresent {
					var parsedAttr langwatchAttrValue
					err := json.Unmarshal([]byte(inputAttrValue.AsString()), &parsedAttr)
					require.NoError(t, err, "Failed to parse langwatch.input attribute: %s", inputAttrValue.AsString())
					assert.Equal(t, "json", parsedAttr.Type, "langwatch.input attribute type mismatch")

					// Extract messages from tt.requestBody for comparison
					var reqBodyData struct {
						Messages json.RawMessage `json:"messages"`
					}
					err = json.Unmarshal([]byte(tt.requestBody), &reqBodyData)
					require.NoError(t, err, "Failed to parse tt.requestBody to extract messages: %s", tt.requestBody)
					expectedMessagesJSON := string(reqBodyData.Messages)
					if expectedMessagesJSON == "" || expectedMessagesJSON == "null" { // Handle cases where messages might not be present or explicitly null
						// If tt.requestBody doesn't have messages, parsedAttr.Value should also reflect that (e.g. be an empty object or null)
						// For now, assuming that if messages is what's captured, it should not be empty if tt.requestBody is not.
						// This part might need refinement based on how non-message requests are handled.
						assert.JSONEq(t, tt.requestBody, string(parsedAttr.Value), "Attribute '%s' JSON value mismatch (expected full body as messages were not extractable)", string(langwatch.AttributeLangWatchInput))
					} else {
						assert.JSONEq(t, expectedMessagesJSON, string(parsedAttr.Value), "Attribute '%s' JSON value (messages) mismatch", string(langwatch.AttributeLangWatchInput))
					}
				}

				outputAttrValue, outputPresent := findAttr(recordedAttrs, langwatch.AttributeLangWatchOutput)
				if tt.name == "Chat Completion Success With Recording" {
					assert.True(t, outputPresent, "Output value attribute should be present for non-streaming recording")
					if outputPresent {
						var parsedAttr langwatchAttrValue
						err := json.Unmarshal([]byte(outputAttrValue.AsString()), &parsedAttr)
						require.NoError(t, err, "Failed to parse langwatch.output attribute (non-streaming): %s", outputAttrValue.AsString())
						assert.Equal(t, "json", parsedAttr.Type, "langwatch.output attribute type mismatch (non-streaming)")

						// Validate semantic content rather than exact JSON structure
						var actualOutput map[string]interface{}
						err = json.Unmarshal(parsedAttr.Value, &actualOutput)
						require.NoError(t, err, "Failed to parse actual output JSON")

						// Parse expected output for key field validation
						var expectedOutput map[string]interface{}
						err = json.Unmarshal([]byte(tt.mockResponseBody), &expectedOutput)
						require.NoError(t, err, "Failed to parse expected output JSON")

						// Validate essential fields are present and correct
						assert.Equal(t, expectedOutput["id"], actualOutput["id"], "Response ID mismatch")
						assert.Equal(t, expectedOutput["model"], actualOutput["model"], "Response model mismatch")
						assert.Equal(t, expectedOutput["object"], actualOutput["object"], "Response object type mismatch")
						assert.Equal(t, expectedOutput["created"], actualOutput["created"], "Response created timestamp mismatch")
						assert.Equal(t, expectedOutput["system_fingerprint"], actualOutput["system_fingerprint"], "System fingerprint mismatch")

						// Validate usage information
						if expectedUsage, ok := expectedOutput["usage"].(map[string]interface{}); ok {
							actualUsage, usageOk := actualOutput["usage"].(map[string]interface{})
							assert.True(t, usageOk, "Usage information should be present")
							if usageOk {
								assert.Equal(t, expectedUsage["prompt_tokens"], actualUsage["prompt_tokens"], "Prompt tokens mismatch")
								assert.Equal(t, expectedUsage["completion_tokens"], actualUsage["completion_tokens"], "Completion tokens mismatch")
								assert.Equal(t, expectedUsage["total_tokens"], actualUsage["total_tokens"], "Total tokens mismatch")
							}
						}

						// Validate choices content
						if expectedChoices, ok := expectedOutput["choices"].([]interface{}); ok {
							actualChoices, choicesOk := actualOutput["choices"].([]interface{})
							assert.True(t, choicesOk, "Choices should be present")
							if choicesOk && len(expectedChoices) > 0 && len(actualChoices) > 0 {
								expectedChoice := expectedChoices[0].(map[string]interface{})
								actualChoice := actualChoices[0].(map[string]interface{})

								assert.Equal(t, expectedChoice["index"], actualChoice["index"], "Choice index mismatch")
								assert.Equal(t, expectedChoice["finish_reason"], actualChoice["finish_reason"], "Finish reason mismatch")

								// Validate message content
								if expectedMsg, msgOk := expectedChoice["message"].(map[string]interface{}); msgOk {
									actualMsg, actualMsgOk := actualChoice["message"].(map[string]interface{})
									assert.True(t, actualMsgOk, "Message should be present")
									if actualMsgOk {
										assert.Equal(t, expectedMsg["role"], actualMsg["role"], "Message role mismatch")
										assert.Equal(t, expectedMsg["content"], actualMsg["content"], "Message content mismatch")
									}
								}
							}
						}
					}
				} else if tt.name == "Chat Completion Stream Success With Recording" {
					assert.True(t, outputPresent, "Attribute '%s' should be present for stream (set by mock)", string(langwatch.AttributeLangWatchOutput))
					if outputPresent {
						var parsedAttr langwatchAttrValue
						err := json.Unmarshal([]byte(outputAttrValue.AsString()), &parsedAttr)
						require.NoError(t, err, "Failed to parse langwatch.output attribute (streaming): %s", outputAttrValue.AsString())
						assert.Equal(t, "text", parsedAttr.Type, "langwatch.output attribute type mismatch (streaming)")
						var streamTextContent string
						err = json.Unmarshal(parsedAttr.Value, &streamTextContent)
						require.NoError(t, err, "Failed to unmarshal streaming text content from: %s", string(parsedAttr.Value))
						assert.Equal(t, "one", streamTextContent, "Attribute '%s' value mismatch for stream", string(langwatch.AttributeLangWatchOutput))
					}
				} else {
					assert.Equal(t, shouldRecordOutput, outputPresent, "Mismatch in presence of output value attribute for %s", tt.name)
				}
			}
		})
	}
}

// hasOption checks if a slice of options contains a specific option.
func hasOption(opts []Option, targetOpt Option) bool {
	targetConf := config{}
	targetOpt.apply(&targetConf)
	isTargetInput := targetConf.recordInput
	isTargetOutput := targetConf.recordOutput

	for _, opt := range opts {
		dummyConf := config{}
		opt.apply(&dummyConf)
		if isTargetInput && dummyConf.recordInput {
			return true
		}
		if isTargetOutput && dummyConf.recordOutput {
			return true
		}
	}
	return false
}

func TestMiddleware_NextReturnsError(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	// Defer shutdown of the span processor and exporter
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	// Set the global tracer provider for this test
	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	defer otel.SetTracerProvider(originalTracerProvider) // Restore original

	expectedError := errors.New("mock next error")
	var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
		return nil, expectedError
	}

	middleware := Middleware("testClient", WithTracerProvider(tp))
	req := httptest.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", nil)
	_, err := middleware(req, nextFunc)

	require.Error(t, err)
	assert.Equal(t, expectedError, err)

	// Force flush to ensure all spans are exported
	err = tp.ForceFlush(context.Background())
	require.NoError(t, err)

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, codes.Error, span.Status.Code)
	assert.Equal(t, expectedError.Error(), span.Status.Description)

	// Check for recorded error events
	foundErrorEvent := false
	for _, event := range span.Events {
		if event.Name == "exception" {
			foundErrorEvent = true
			// Further checks can be added here for attributes like "exception.message"
		}
	}
	assert.True(t, foundErrorEvent, "expected an exception event to be recorded")
}

func TestMiddleware_NextReturnsErrorWithResponse(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	// Set the global tracer provider for this test
	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	defer otel.SetTracerProvider(originalTracerProvider) // Restore original

	expectedError := errors.New("mock next error with response")
	mockResponse := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       http.NoBody,
	}
	var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
		return mockResponse, expectedError
	}

	middleware := Middleware("testClient", WithTracerProvider(tp))
	req := httptest.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", nil)
	resp, err := middleware(req, nextFunc)
	require.Error(t, err)
	assert.Equal(t, expectedError, err)
	assert.Equal(t, mockResponse, resp)

	// Force flush to ensure all spans are exported
	err = tp.ForceFlush(context.Background())
	require.NoError(t, err)

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, codes.Error, span.Status.Code)
	assert.Equal(t, expectedError.Error(), span.Status.Description)

	// Check for HTTP status code attribute
	foundStatusCodeAttr := false
	for _, attr := range span.Attributes {
		if attr.Key == semconv.HTTPResponseStatusCodeKey {
			foundStatusCodeAttr = true
			assert.Equal(t, int64(http.StatusInternalServerError), attr.Value.AsInt64())
			break
		}
	}
	assert.True(t, foundStatusCodeAttr, "HTTPResponseStatusCodeKey attribute not found")

	// Check for recorded error events
	foundErrorEvent := false
	for _, event := range span.Events {
		if event.Name == "exception" {
			foundErrorEvent = true
		}
	}
	assert.True(t, foundErrorEvent, "expected an exception event to be recorded")
}

// TestGetGenAIOperationFromPath tests the operation detection logic
func TestGetGenAIOperationFromPath(t *testing.T) {
	tests := []struct {
		path     string
		expected attribute.KeyValue
	}{
		// Standard OpenAI API paths
		{"/v1/chat/completions", semconv.GenAIOperationNameChat},
		{"/v1/completions", semconv.GenAIOperationNameTextCompletion},
		{"/v1/embeddings", semconv.GenAIOperationNameEmbeddings},
		{"/v1/responses", semconv.GenAIOperationNameKey.String("responses")},
		{"/v1/audio/speech", semconv.GenAIOperationNameKey.String("audio")},
		{"/v1/images/generations", semconv.GenAIOperationNameKey.String("images")},

		// Azure OpenAI paths (for backward compatibility)
		{"/openai/deployments/gpt-4/chat/completions", semconv.GenAIOperationNameChat},
		{"/openai/deployments/gpt-4/responses", semconv.GenAIOperationNameKey.String("responses")},

		// Edge cases
		{"/v1/unknown", semconv.GenAIOperationNameKey.String("unknown")},
		{"/some/random/path", semconv.GenAIOperationNameChat}, // fallback
		{"", semconv.GenAIOperationNameChat},                  // empty path fallback
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			result := getGenAIOperationFromPath(test.path)
			if result.Key != test.expected.Key || result.Value.AsString() != test.expected.Value.AsString() {
				t.Errorf("Expected %v, got %v", test.expected, result)
			}
		})
	}
}
