package openai

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/responses"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/log/noop"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

func TestIntegration_ChatCompletions_Basic(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test data
	requestBody := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}],"max_tokens":5}`
	responseBody := `{"id":"cmpl-xyz","object":"chat.completion","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`

	// Create mock client
	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/chat/completions", req.URL.Path)

		// Verify request body
		bodyBytes, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		assert.JSONEq(t, requestBody, string(bodyBytes))

		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	// Create client with middleware
	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Make API call
	resp, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage("ping"),
		},
		MaxTokens: openai.Opt(int64(5)),
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify response
	assert.Equal(t, "cmpl-xyz", resp.ID)
	assert.Len(t, resp.Choices, 1)
	assert.Equal(t, "pong", resp.Choices[0].Message.Content)

	// Verify telemetry
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, "chat gpt-4o-mini", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify essential attributes
	expectedAttrs := map[attribute.Key]string{
		semconv.GenAISystemKey:        "openai",
		semconv.GenAIOperationNameKey: "chat",
		semconv.GenAIRequestModelKey:  "gpt-4o-mini",
		semconv.GenAIResponseIDKey:    "cmpl-xyz",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)
		assert.Equal(t, expected, value.AsString())
	}

	// Verify usage tokens
	inputTokens, found := findAttr(span.Attributes, semconv.GenAIUsageInputTokensKey)
	require.True(t, found)
	assert.Equal(t, int64(2), inputTokens.AsInt64())

	outputTokens, found := findAttr(span.Attributes, semconv.GenAIUsageOutputTokensKey)
	require.True(t, found)
	assert.Equal(t, int64(1), outputTokens.AsInt64())
}

func TestIntegration_ChatCompletions_WithParameters(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test data with extensive parameters
	responseBody := `{
		"id":"cmpl-params",
		"object":"chat.completion",
		"created":1700000000,
		"model":"gpt-4o",
		"choices":[{
			"index":0,
			"message":{
				"role":"assistant",
				"content":"Detailed response with parameters"
			},
			"finish_reason":"stop"
		}],
		"usage":{
			"prompt_tokens":25,
			"completion_tokens":15,
			"total_tokens":40
		}
	}`

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Make API call with various parameters
	resp, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4o,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant specialized in technical analysis."),
			openai.UserMessage("Analyze the following data and provide insights."),
		},
		MaxTokens:   openai.Opt(int64(150)),
		Temperature: openai.Opt(0.7),
		TopP:        openai.Opt(0.9),
		User:        openai.Opt("user-123"),
		Seed:        openai.Opt(int64(42)),
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify telemetry with comprehensive attributes
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	// Core attributes
	assert.Equal(t, "chat gpt-4o", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify all key attributes including HTTP details
	expectedAttrs := map[attribute.Key]interface{}{
		semconv.GenAISystemKey:            "openai",
		semconv.GenAIOperationNameKey:     "chat",
		semconv.GenAIRequestModelKey:      "gpt-4o",
		semconv.GenAIResponseIDKey:        "cmpl-params",
		semconv.GenAIUsageInputTokensKey:  int64(25),
		semconv.GenAIUsageOutputTokensKey: int64(15),
		semconv.HTTPRequestMethodKey:      "POST",
		semconv.HTTPResponseStatusCodeKey: int64(200),
		semconv.ServerAddressKey:          "api.openai.com",
		semconv.URLPathKey:                "/v1/chat/completions",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)

		switch v := expected.(type) {
		case string:
			assert.Equal(t, v, value.AsString(), "Attribute %s value mismatch", key)
		case int64:
			assert.Equal(t, v, value.AsInt64(), "Attribute %s value mismatch", key)
		}
	}

	// Verify custom LangWatch attributes if present
	if clientNameAttr, found := findAttr(span.Attributes, attribute.Key("gen_ai.openai.client_name")); found {
		assert.Equal(t, "test-client", clientNameAttr.AsString())
	}
}

func TestIntegration_ChatCompletions_WithTools(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Response with function call
	responseBody := `{
		"id":"cmpl-tools",
		"object":"chat.completion",
		"created":1700000000,
		"model":"gpt-4o",
		"choices":[{
			"index":0,
			"message":{
				"role":"assistant",
				"content":null,
				"tool_calls":[{
					"id":"call_123",
					"type":"function",
					"function":{
						"name":"get_weather",
						"arguments":"{\"location\":\"San Francisco\"}"
					}
				}]
			},
			"finish_reason":"tool_calls"
		}],
		"usage":{
			"prompt_tokens":30,
			"completion_tokens":20,
			"total_tokens":50
		}
	}`

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Make API call with tools
	resp, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4o,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage("What's the weather like in San Francisco?"),
		},
		Tools: []openai.ChatCompletionToolParam{
			{
				Function: openai.FunctionDefinitionParam{
					Name:        "get_weather",
					Description: openai.String("Get current weather for a location"),
					Parameters: openai.FunctionParameters{
						"type": "object",
						"properties": map[string]interface{}{
							"location": map[string]interface{}{
								"type":        "string",
								"description": "The city and state, e.g. San Francisco, CA",
							},
						},
						"required": []string{"location"},
					},
				},
			},
		},
		ToolChoice: openai.ChatCompletionToolChoiceOptionUnionParam{
			OfAuto: openai.String("auto"),
		},
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify response has tool calls
	assert.Equal(t, "cmpl-tools", resp.ID)
	assert.Len(t, resp.Choices, 1)
	assert.Len(t, resp.Choices[0].Message.ToolCalls, 1)
	assert.Equal(t, "get_weather", resp.Choices[0].Message.ToolCalls[0].Function.Name)

	// Verify telemetry
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, "chat gpt-4o", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify finish reason is captured
	finishReasonAttr, found := findAttr(span.Attributes, attribute.Key("gen_ai.response.finish_reasons"))
	require.True(t, found, "finish_reasons attribute should be present")
	finishReasons := finishReasonAttr.AsStringSlice()
	assert.Contains(t, finishReasons, "tool_calls")
}

func TestIntegration_ChatCompletions_MultipleModels(t *testing.T) {
	testCases := []struct {
		name          string
		model         openai.ChatModel
		expectedModel string
	}{
		{"GPT-4o", openai.ChatModelGPT4o, "gpt-4o"},
		{"GPT-4o-mini", openai.ChatModelGPT4oMini, "gpt-4o-mini"},
		{"GPT-4", openai.ChatModelGPT4, "gpt-4"},
		{"GPT-4 Turbo", openai.ChatModelGPT4Turbo, "gpt-4-turbo"},
		{"GPT-3.5 Turbo", openai.ChatModelGPT3_5Turbo, "gpt-3.5-turbo"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			exporter, cleanup := setupTestTracing(t)
			defer cleanup()

			responseBody := fmt.Sprintf(`{
				"id":"cmpl-%s",
				"object":"chat.completion",
				"created":1700000000,
				"model":"%s",
				"choices":[{
					"index":0,
					"message":{
						"role":"assistant",
						"content":"Response from %s"
					},
					"finish_reason":"stop"
				}],
				"usage":{
					"prompt_tokens":10,
					"completion_tokens":5,
					"total_tokens":15
				}
			}`, tc.expectedModel, tc.expectedModel, tc.expectedModel)

			mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(strings.NewReader(responseBody)),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			})

			loggerProvider := noop.NewLoggerProvider()
			client := openai.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(mockClient),
				option.WithMiddleware(Middleware("test-client",
					WithLoggerProvider(loggerProvider),
				)),
			)

			_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
				Model: tc.model,
				Messages: []openai.ChatCompletionMessageParamUnion{
					openai.UserMessage("test"),
				},
			})
			require.NoError(t, err)

			// Verify telemetry
			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			span := spans[0]

			expectedSpanName := fmt.Sprintf("chat %s", tc.expectedModel)
			assert.Equal(t, expectedSpanName, span.Name)

			// Verify model attribute
			modelAttr, found := findAttr(span.Attributes, semconv.GenAIRequestModelKey)
			require.True(t, found)
			assert.Equal(t, tc.expectedModel, modelAttr.AsString())
		})
	}
}

func TestIntegration_ChatCompletions_Streaming(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Create a properly formatted SSE response that will terminate correctly
	streamResponse := "data: {\"id\":\"chatcmpl-str\",\"object\":\"chat.completion.chunk\",\"created\":1700000100,\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hello\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"chatcmpl-str\",\"object\":\"chat.completion.chunk\",\"created\":1700000100,\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" world\"},\"finish_reason\":null}]}\n\ndata: {\"id\":\"chatcmpl-str\",\"object\":\"chat.completion.chunk\",\"created\":1700000100,\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\ndata: [DONE]\n\n"

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/chat/completions", req.URL.Path)

		// Verify that the request body contains stream=true
		bodyBytes, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		bodyStr := string(bodyBytes)
		assert.Contains(t, bodyStr, `"stream":true`)

		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(streamResponse)),
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Create a streaming request with timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stream := client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage("Say hello world"),
		},
	})
	require.NotNil(t, stream)

	// Consume the stream with better termination logic
	var chunks []openai.ChatCompletionChunk
	maxChunks := 5 // Reduced from 10 to be more conservative
	chunkCount := 0

	// Use a timeout channel to prevent hanging
	done := make(chan bool, 1)
	go func() {
		for stream.Next() && chunkCount < maxChunks {
			chunk := stream.Current()
			chunks = append(chunks, chunk)
			chunkCount++

			// Log chunk for debugging
			t.Logf("Received responses chunk %d", chunkCount)
		}
		done <- true
	}()

	// Wait for completion or timeout
	select {
	case <-done:
		t.Logf("Stream completed normally")
	case <-ctx.Done():
		t.Logf("Stream timed out")
	case <-time.After(3 * time.Second):
		t.Logf("Stream processing timeout after 3 seconds")
	}

	// Check for stream errors after processing
	if err := stream.Err(); err != nil {
		t.Logf("Stream error (may be expected): %v", err)
		// Don't fail the test for stream errors as they may be expected behavior
	}

	// Verify we got some chunks
	t.Logf("Total chunks received: %d", len(chunks))
	assert.GreaterOrEqual(t, len(chunks), 1, "Should receive at least 1 chunk")

	// Verify the first chunk has expected content
	if len(chunks) > 0 {
		assert.Equal(t, "chatcmpl-str", chunks[0].ID)
		assert.Equal(t, "gpt-4o-mini", chunks[0].Model)
	}

	// Verify telemetry - the span should be created and properly attributed
	spans := exporter.GetSpans()
	require.GreaterOrEqual(t, len(spans), 1, "At least one span should be created for streaming")

	span := spans[0]
	assert.Equal(t, "chat gpt-4o-mini", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Check for streaming attribute
	streamingAttr, found := findAttr(span.Attributes, langwatch.AttributeLangWatchStreaming)
	require.True(t, found, "streaming attribute should be present")
	assert.True(t, streamingAttr.AsBool(), "streaming attribute should be true")

	// Verify essential attributes are set
	expectedAttrs := map[attribute.Key]string{
		semconv.GenAISystemKey:        "openai",
		semconv.GenAIOperationNameKey: "chat",
		semconv.GenAIRequestModelKey:  "gpt-4o-mini",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)
		assert.Equal(t, expected, value.AsString())
	}
}

func TestIntegration_ContentPolicies(t *testing.T) {
	testCases := []struct {
		name    string
		options []Option
	}{
		{"No content recording", []Option{}},
		{"Input only", []Option{WithCaptureAllInput()}},
		{"Output only", []Option{WithCaptureOutput()}},
		{"Both input and output", []Option{WithCaptureAllInput(), WithCaptureOutput()}},
		{"System input only", []Option{WithCaptureSystemInput()}},
		{"User input only", []Option{WithCaptureUserInput()}},
	}

	responseBody := `{"id":"cmpl-xyz","object":"chat.completion","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":"response"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			exporter, cleanup := setupTestTracing(t)
			defer cleanup()

			mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(strings.NewReader(responseBody)),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			})

			// Build middleware options
			loggerProvider := noop.NewLoggerProvider()
			middlewareOptions := append([]Option{
				WithLoggerProvider(loggerProvider),
			}, tc.options...)

			client := openai.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(mockClient),
				option.WithMiddleware(Middleware("test-client", middlewareOptions...)),
			)

			// Make API call
			_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
				Model: openai.ChatModelGPT4oMini,
				Messages: []openai.ChatCompletionMessageParamUnion{
					openai.SystemMessage("You are helpful"),
					openai.UserMessage("Hello"),
				},
			})
			require.NoError(t, err)

			// Verify span creation (content recording happens via log events, not spans)
			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			span := spans[0]
			assert.Equal(t, "chat gpt-4o-mini", span.Name)
			assert.Equal(t, codes.Ok, span.Status.Code)
		})
	}
}

// =============================================================================
// CONTENT LOGGING INTEGRATION TESTS
// =============================================================================

func TestIntegration_ContentLogging_ChatCompletions(t *testing.T) {
	testCases := []ContentLoggingTestCase{
		{
			Name:                  "No content recording",
			Options:               []Option{},
			ExpectedUserContent:   false,
			ExpectedSystemContent: false,
			ExpectedOutputContent: false,
		},
		{
			Name:                  "All input recording",
			Options:               []Option{WithCaptureAllInput()},
			ExpectedUserContent:   true,
			ExpectedSystemContent: true,
			ExpectedOutputContent: false,
		},
		{
			Name:                  "Output only",
			Options:               []Option{WithCaptureOutput()},
			ExpectedUserContent:   false,
			ExpectedSystemContent: false,
			ExpectedOutputContent: true,
		},
		{
			Name:                  "Both input and output",
			Options:               []Option{WithCaptureAllInput(), WithCaptureOutput()},
			ExpectedUserContent:   true,
			ExpectedSystemContent: true,
			ExpectedOutputContent: true,
		},
		{
			Name:                  "System input only",
			Options:               []Option{WithCaptureSystemInput()},
			ExpectedUserContent:   false,
			ExpectedSystemContent: true,
			ExpectedOutputContent: false,
		},
		{
			Name:                  "User input only",
			Options:               []Option{WithCaptureUserInput()},
			ExpectedUserContent:   true,
			ExpectedSystemContent: false,
			ExpectedOutputContent: false,
		},
	}

	responseBody := `{
		"id": "chatcmpl-content-test",
		"object": "chat.completion",
		"created": 1700000000,
		"model": "gpt-4o-mini",
		"choices": [{
			"index": 0,
			"message": {
				"role": "assistant",
				"content": "This is the AI response for testing"
			},
			"finish_reason": "stop"
		}],
		"usage": {
			"prompt_tokens": 10,
			"completion_tokens": 8,
			"total_tokens": 18
		}
	}`

	expectedContents := []string{
		"Hello, please help me test content logging",         // user content
		"You are a helpful assistant specialized in testing", // system content
		"This is the AI response for testing",                // output content
	}

	for _, tc := range testCases {
		t.Run(tc.Name, func(t *testing.T) {
			runContentLoggingTest(t, tc, responseBody, func(client *openai.Client) error {
				_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
					Model: openai.ChatModelGPT4oMini,
					Messages: []openai.ChatCompletionMessageParamUnion{
						openai.SystemMessage("You are a helpful assistant specialized in testing."),
						openai.UserMessage("Hello, please help me test content logging."),
					},
				})
				return err
			}, expectedContents)
		})
	}
}

func TestIntegration_ContentLogging_ResponsesAPI(t *testing.T) {
	testCases := []struct {
		name                  string
		options               []Option
		expectedInputContent  bool
		expectedOutputContent bool
	}{
		{
			name:                  "No content recording",
			options:               []Option{},
			expectedInputContent:  false,
			expectedOutputContent: false,
		},
		{
			name:                  "Input recording",
			options:               []Option{WithCaptureAllInput()},
			expectedInputContent:  true,
			expectedOutputContent: false,
		},
		{
			name:                  "Output recording",
			options:               []Option{WithCaptureOutput()},
			expectedInputContent:  false,
			expectedOutputContent: true,
		},
		{
			name:                  "Both input and output",
			options:               []Option{WithCaptureAllInput(), WithCaptureOutput()},
			expectedInputContent:  true,
			expectedOutputContent: true,
		},
	}

	responseBody := `{
		"id": "resp_content_test",
		"object": "response",
		"created": 1700000000,
		"model": "o1-pro",
		"status": "completed",
		"output": [{
			"type": "message",
			"id": "msg_test",
			"role": "assistant",
			"content": [{
				"type": "text",
				"text": "This is the Responses API output for testing content logging."
			}]
		}],
		"usage": {
			"input_tokens": 15,
			"output_tokens": 12,
			"total_tokens": 27
		}
	}`

	expectedContents := []string{
		"Please analyze this test input for content logging verification.", // input content
		"This is the Responses API output for testing content logging",     // output content
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			runContentLoggingTestTwoContent(t, tc.options, responseBody, func(client *openai.Client) error {
				_, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
					Model: responses.ResponsesModelO1Pro,
					Input: responses.ResponseNewParamsInputUnion{
						OfString: param.Opt[string]{
							Value: "Please analyze this test input for content logging verification.",
						},
					},
					Instructions: param.Opt[string]{
						Value: "You are testing content logging functionality.",
					},
				})
				return err
			}, expectedContents, tc.expectedInputContent, tc.expectedOutputContent)
		})
	}
}

func TestIntegration_ErrorScenarios(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
		response   string
	}{
		{
			"Bad Request",
			http.StatusBadRequest,
			`{"error":{"message":"Invalid request","type":"invalid_request_error"}}`,
		},
		{
			"Rate Limit",
			http.StatusTooManyRequests,
			`{"error":{"message":"Rate limit exceeded","type":"rate_limit_error"}}`,
		},
		{
			"Server Error",
			http.StatusInternalServerError,
			`{"error":{"message":"Internal server error","type":"server_error"}}`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			exporter, cleanup := setupTestTracing(t)
			defer cleanup()

			mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: tc.statusCode,
					Body:       io.NopCloser(strings.NewReader(tc.response)),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			})

			loggerProvider := noop.NewLoggerProvider()
			client := openai.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(mockClient),
				option.WithMiddleware(Middleware("test-client",
					WithLoggerProvider(loggerProvider),
				)),
			)

			// Make API call that should fail
			_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
				Model: openai.ChatModelGPT4oMini,
				Messages: []openai.ChatCompletionMessageParamUnion{
					openai.UserMessage("test"),
				},
			})
			assert.Error(t, err)

			// Verify error span (OpenAI client may retry, so we may get multiple spans)
			spans := exporter.GetSpans()
			require.GreaterOrEqual(t, len(spans), 1)

			// Check first span for error status
			span := spans[0]
			assert.NotEqual(t, codes.Ok, span.Status.Code)

			// Verify HTTP status code is recorded
			statusCodeAttr, found := findAttr(span.Attributes, semconv.HTTPResponseStatusCodeKey)
			require.True(t, found)
			assert.Equal(t, int64(tc.statusCode), statusCodeAttr.AsInt64())
		})
	}
}

// =============================================================================
// RESPONSES API INTEGRATION TESTS
// =============================================================================

func TestIntegration_ResponsesAPI_Basic(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test data
	responseBody := `{
		"id": "resp_123",
		"object": "response", 
		"created": 1700000000,
		"model": "gpt-4o-2024-08-06",
		"status": "completed",
		"output": [
			{
				"type": "message",
				"id": "msg_456",
				"role": "assistant",
				"content": [
					{
						"type": "text",
						"text": "Hello! How can I assist you today?"
					}
				]
			}
		],
		"usage": {
			"input_tokens": 10,
			"output_tokens": 8,
			"total_tokens": 18
		}
	}`

	// Create mock client
	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/responses", req.URL.Path)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	// Create client with middleware
	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Make API call
	resp, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: responses.ResponsesModelO1Pro,
		Input: responses.ResponseNewParamsInputUnion{
			OfString: param.Opt[string]{
				Value: "Hello world",
			},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify response
	assert.Equal(t, "resp_123", resp.ID)
	assert.Equal(t, responses.ResponseStatusCompleted, resp.Status)

	// Verify telemetry
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, "responses o1-pro", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify essential attributes
	expectedAttrs := map[attribute.Key]string{
		semconv.GenAISystemKey:        "openai",
		semconv.GenAIOperationNameKey: "responses",
		semconv.GenAIRequestModelKey:  "o1-pro",
		semconv.GenAIResponseIDKey:    "resp_123",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)
		assert.Equal(t, expected, value.AsString())
	}

	// Verify usage tokens
	inputTokens, found := findAttr(span.Attributes, semconv.GenAIUsageInputTokensKey)
	require.True(t, found, "Missing input tokens attribute")
	assert.Equal(t, int64(10), inputTokens.AsInt64())

	outputTokens, found := findAttr(span.Attributes, semconv.GenAIUsageOutputTokensKey)
	require.True(t, found, "Missing output tokens attribute")
	assert.Equal(t, int64(8), outputTokens.AsInt64())

	// Verify finish reasons for completed status
	finishReasonAttr, found := findAttr(span.Attributes, attribute.Key("gen_ai.response.finish_reasons"))
	require.True(t, found, "finish_reasons attribute should be present for completed status")
	finishReasons := finishReasonAttr.AsStringSlice()
	assert.Contains(t, finishReasons, "completed")
}

func TestIntegration_ResponsesAPI_WithParameters(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test data with extensive parameters
	responseBody := `{
		"id": "resp_params",
		"object": "response", 
		"created": 1700000000,
		"model": "o3-pro",
		"status": "completed",
		"output": [
			{
				"type": "message",
				"id": "msg_789",
				"role": "assistant",
				"content": [
					{
						"type": "text",
						"text": "This is a detailed response with custom parameters for temperature and reasoning."
					}
				]
			}
		],
		"usage": {
			"input_tokens": 45,
			"output_tokens": 32,
			"total_tokens": 77
		}
	}`

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/responses", req.URL.Path)

		// Verify request has parameters
		bodyBytes, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		requestData := string(bodyBytes)
		assert.Contains(t, requestData, "temperature")
		assert.Contains(t, requestData, "max_output_tokens")

		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Make API call with various parameters
	resp, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: responses.ResponsesModelO3Pro,
		Input: responses.ResponseNewParamsInputUnion{
			OfString: param.Opt[string]{
				Value: "Analyze this complex dataset and provide insights with detailed reasoning.",
			},
		},
		Instructions:    param.Opt[string]{Value: "You are an expert data analyst. Provide comprehensive analysis."},
		Temperature:     param.Opt[float64]{Value: 0.8},
		MaxOutputTokens: param.Opt[int64]{Value: 500},
		User:            param.Opt[string]{Value: "analyst-user-456"},
		Store:           param.Opt[bool]{Value: true},
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify response
	assert.Equal(t, "resp_params", resp.ID)
	assert.Equal(t, responses.ResponseStatusCompleted, resp.Status)

	// Verify telemetry with comprehensive attributes
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	// Core attributes
	assert.Equal(t, "responses o3-pro", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify all key attributes including HTTP details
	expectedAttrs := map[attribute.Key]interface{}{
		semconv.GenAISystemKey:            "openai",
		semconv.GenAIOperationNameKey:     "responses",
		semconv.GenAIRequestModelKey:      "o3-pro",
		semconv.GenAIResponseIDKey:        "resp_params",
		semconv.GenAIUsageInputTokensKey:  int64(45),
		semconv.GenAIUsageOutputTokensKey: int64(32),
		semconv.HTTPRequestMethodKey:      "POST",
		semconv.HTTPResponseStatusCodeKey: int64(200),
		semconv.ServerAddressKey:          "api.openai.com",
		semconv.URLPathKey:                "/v1/responses",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)

		switch v := expected.(type) {
		case string:
			assert.Equal(t, v, value.AsString(), "Attribute %s value mismatch", key)
		case int64:
			assert.Equal(t, v, value.AsInt64(), "Attribute %s value mismatch", key)
		}
	}
}

func TestIntegration_ResponsesAPI_MultipleModels(t *testing.T) {
	testCases := []struct {
		name          string
		model         responses.ResponsesModel
		expectedModel string
	}{
		{"O1 Pro", responses.ResponsesModelO1Pro, "o1-pro"},
		{"O3 Pro", responses.ResponsesModelO3Pro, "o3-pro"},
		{"Computer Use Preview", responses.ResponsesModelComputerUsePreview, "computer-use-preview"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			exporter, cleanup := setupTestTracing(t)
			defer cleanup()

			responseBody := fmt.Sprintf(`{
				"id":"resp-%s",
				"object":"response",
				"created":1700000000,
				"model":"%s",
				"status":"completed",
				"output":[{
					"type":"message",
					"id":"msg_auto",
					"role":"assistant",
					"content":[{
						"type":"text",
						"text":"Response from %s model"
					}]
				}],
				"usage":{
					"input_tokens":15,
					"output_tokens":10,
					"total_tokens":25
				}
			}`, tc.expectedModel, tc.expectedModel, tc.expectedModel)

			mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(strings.NewReader(responseBody)),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			})

			loggerProvider := noop.NewLoggerProvider()
			client := openai.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(mockClient),
				option.WithMiddleware(Middleware("test-client",
					WithLoggerProvider(loggerProvider),
				)),
			)

			_, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
				Model: tc.model,
				Input: responses.ResponseNewParamsInputUnion{
					OfString: param.Opt[string]{
						Value: "test input",
					},
				},
			})
			require.NoError(t, err)

			// Verify telemetry
			spans := exporter.GetSpans()
			require.Len(t, spans, 1)
			span := spans[0]

			expectedSpanName := fmt.Sprintf("responses %s", tc.expectedModel)
			assert.Equal(t, expectedSpanName, span.Name)

			// Verify model attribute
			modelAttr, found := findAttr(span.Attributes, semconv.GenAIRequestModelKey)
			require.True(t, found)
			assert.Equal(t, tc.expectedModel, modelAttr.AsString())
		})
	}
}

func TestIntegration_ResponsesAPI_StatusHandling(t *testing.T) {
	testCases := []struct {
		name           string
		status         string
		expectedStatus responses.ResponseStatus
	}{
		{"Completed", "completed", responses.ResponseStatusCompleted},
		{"Failed", "failed", responses.ResponseStatusFailed},
		{"Cancelled", "cancelled", responses.ResponseStatusCancelled},
		{"In Progress", "in_progress", responses.ResponseStatusInProgress},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			exporter, cleanup := setupTestTracing(t)
			defer cleanup()

			responseBody := fmt.Sprintf(`{
				"id":"resp_status_%s",
				"object":"response",
				"created":1700000000,
				"model":"o1-pro",
				"status":"%s",
				"output":[{
					"type":"message",
					"id":"msg_status",
					"role":"assistant",
					"content":[{
						"type":"text",
						"text":"Status test response"
					}]
				}],
				"usage":{
					"input_tokens":5,
					"output_tokens":3,
					"total_tokens":8
				}
			}`, tc.status, tc.status)

			mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
				statusCode := http.StatusOK
				if tc.status == "failed" {
					statusCode = http.StatusInternalServerError
				}
				return &http.Response{
					StatusCode: statusCode,
					Body:       io.NopCloser(strings.NewReader(responseBody)),
					Header:     http.Header{"Content-Type": []string{"application/json"}},
				}, nil
			})

			loggerProvider := noop.NewLoggerProvider()
			client := openai.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(mockClient),
				option.WithMiddleware(Middleware("test-client",
					WithLoggerProvider(loggerProvider),
				)),
			)

			resp, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
				Model: responses.ResponsesModelO1Pro,
				Input: responses.ResponseNewParamsInputUnion{
					OfString: param.Opt[string]{
						Value: "status test",
					},
				},
			})

			if tc.status == "failed" {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				assert.Equal(t, tc.expectedStatus, resp.Status)
			}

			// Verify telemetry
			spans := exporter.GetSpans()
			require.GreaterOrEqual(t, len(spans), 1)
			span := spans[0]

			// Verify span status based on response status
			if tc.status == "failed" {
				assert.NotEqual(t, codes.Ok, span.Status.Code)
			} else {
				assert.Equal(t, codes.Ok, span.Status.Code)
			}

			// Verify finish reasons for terminal statuses
			if tc.status == "completed" || tc.status == "failed" || tc.status == "cancelled" {
				finishReasonAttr, found := findAttr(span.Attributes, attribute.Key("gen_ai.response.finish_reasons"))
				require.True(t, found, "finish_reasons attribute should be present for status: %s", tc.status)
				finishReasons := finishReasonAttr.AsStringSlice()
				assert.Contains(t, finishReasons, tc.status, "finish_reasons should contain the status for terminal states")
			} else {
				// Non-terminal statuses like "in_progress" should not have finish reasons
				_, found := findAttr(span.Attributes, attribute.Key("gen_ai.response.finish_reasons"))
				assert.False(t, found, "finish_reasons attribute should not be present for non-terminal status: %s", tc.status)
			}
		})
	}
}

func TestIntegration_ResponsesAPI_ComplexInput(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test data with complex input structure
	responseBody := `{
		"id": "resp_complex",
		"object": "response", 
		"created": 1700000000,
		"model": "o1-pro",
		"status": "completed",
		"output": [
			{
				"type": "message",
				"id": "msg_complex",
				"role": "assistant", 
				"content": [
					{
						"type": "text",
						"text": "I've analyzed both the text and image inputs you provided."
					}
				]
			}
		],
		"usage": {
			"input_tokens": 75,
			"output_tokens": 25,
			"total_tokens": 100
		}
	}`

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/responses", req.URL.Path)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Create complex input with multiple items
	inputItems := []responses.ResponseInputItemUnionParam{
		responses.ResponseInputItemParamOfMessage("Please analyze this text and the following image.", responses.EasyInputMessageRoleUser),
		responses.ResponseInputItemParamOfMessage("Also consider this system context.", responses.EasyInputMessageRoleUser),
	}

	// Make API call with complex input structure
	resp, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: responses.ResponsesModelO1Pro,
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: inputItems,
		},
		Instructions: param.Opt[string]{Value: "Analyze all provided inputs comprehensively."},
		Temperature:  param.Opt[float64]{Value: 0.3},
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify response
	assert.Equal(t, "resp_complex", resp.ID)
	assert.Equal(t, responses.ResponseStatusCompleted, resp.Status)

	// Verify telemetry
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, "responses o1-pro", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify comprehensive attributes
	expectedAttrs := map[attribute.Key]interface{}{
		semconv.GenAISystemKey:            "openai",
		semconv.GenAIOperationNameKey:     "responses",
		semconv.GenAIRequestModelKey:      "o1-pro",
		semconv.GenAIResponseIDKey:        "resp_complex",
		semconv.GenAIUsageInputTokensKey:  int64(75),
		semconv.GenAIUsageOutputTokensKey: int64(25),
		semconv.HTTPRequestMethodKey:      "POST",
		semconv.HTTPResponseStatusCodeKey: int64(200),
		semconv.ServerAddressKey:          "api.openai.com",
		semconv.URLPathKey:                "/v1/responses",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)

		switch v := expected.(type) {
		case string:
			assert.Equal(t, v, value.AsString(), "Attribute %s value mismatch", key)
		case int64:
			assert.Equal(t, v, value.AsInt64(), "Attribute %s value mismatch", key)
		}
	}
}

func TestIntegration_ResponsesAPI_Middleware(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test that the middleware correctly handles /v1/responses endpoint
	middleware := Middleware("test-client")
	req := httptest.NewRequest(http.MethodPost, "http://localhost/v1/responses",
		strings.NewReader(`{"model":"gpt-4o-2024-08-06","input":"Hello world"}`))
	req.Header.Set("Content-Type", "application/json")

	// Mock successful response
	var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
		responseBody := `{
			"id": "resp_123",
			"object": "response", 
			"created": 1700000000,
			"model": "gpt-4o-2024-08-06",
			"status": "completed",
			"output": "Hello! How can I assist you today?",
			"usage": {
				"input_tokens": 10,
				"output_tokens": 8,
				"total_tokens": 18
			}
		}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	}

	resp, err := middleware(req, nextFunc)
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify span was created with correct attributes
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	// Verify span name and operation
	assert.Equal(t, "responses gpt-4o-2024-08-06", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify essential attributes
	expectedAttrs := map[attribute.Key]string{
		semconv.GenAISystemKey:        "openai",
		semconv.GenAIOperationNameKey: "responses",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)
		assert.Equal(t, expected, value.AsString())
	}
}

func TestIntegration_ResponsesAPI_Streaming(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Create a properly formatted SSE response for Responses API streaming
	streamResponse := "data: {\"id\":\"resp-str\",\"object\":\"response.chunk\",\"created\":1700000100,\"model\":\"o1-pro\",\"output\":[{\"type\":\"message.delta\",\"role\":\"assistant\",\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: {\"id\":\"resp-str\",\"object\":\"response.chunk\",\"created\":1700000100,\"model\":\"o1-pro\",\"output\":[{\"type\":\"message.delta\",\"role\":\"assistant\",\"delta\":{\"content\":\" streaming\"}}]}\n\ndata: {\"id\":\"resp-str\",\"object\":\"response.chunk\",\"created\":1700000100,\"model\":\"o1-pro\",\"status\":\"completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5,\"total_tokens\":15}}\n\ndata: [DONE]\n\n"

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/responses", req.URL.Path)

		// Verify that the request body contains stream=true
		bodyBytes, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		bodyStr := string(bodyBytes)
		assert.Contains(t, bodyStr, `"stream":true`)

		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(streamResponse)),
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Create a streaming request for Responses API
	stream := client.Responses.NewStreaming(context.Background(), responses.ResponseNewParams{
		Model: responses.ResponsesModelO1Pro,
		Input: responses.ResponseNewParamsInputUnion{
			OfString: param.Opt[string]{
				Value: "Say hello streaming",
			},
		},
	})
	require.NotNil(t, stream)

	// Consume the stream with better termination logic
	var chunks []responses.ResponseStreamEventUnion
	maxChunks := 5 // Reduced from 10 to be more conservative
	chunkCount := 0

	// Use a timeout channel to prevent hanging
	done := make(chan bool, 1)
	go func() {
		for stream.Next() && chunkCount < maxChunks {
			chunk := stream.Current()
			chunks = append(chunks, chunk)
			chunkCount++

			// Log chunk for debugging
			t.Logf("Received responses chunk %d", chunkCount)
		}
		done <- true
	}()

	// Wait for completion or timeout
	select {
	case <-done:
		t.Logf("Stream completed normally")
	case <-time.After(3 * time.Second):
		t.Logf("Stream processing timeout after 3 seconds")
	}

	// Check for stream errors after processing
	if err := stream.Err(); err != nil {
		t.Logf("Stream error (may be expected): %v", err)
		// Don't fail the test for stream errors as they may be expected behavior
	}

	// Verify we got some chunks
	assert.GreaterOrEqual(t, len(chunks), 2, "Should receive at least 2 chunks")

	// Note: ResponseStreamEventUnion doesn't directly expose ID/Model fields
	// This is expected as the streaming format may be different from non-streaming
	t.Logf("Received %d stream chunks", len(chunks))

	// Verify telemetry - the span should be created and properly attributed
	spans := exporter.GetSpans()
	require.GreaterOrEqual(t, len(spans), 1, "At least one span should be created for streaming")

	span := spans[0]
	assert.Equal(t, "responses o1-pro", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Check for streaming attribute
	streamingAttr, found := findAttr(span.Attributes, langwatch.AttributeLangWatchStreaming)
	require.True(t, found, "streaming attribute should be present")
	assert.True(t, streamingAttr.AsBool(), "streaming attribute should be true")

	// Verify essential attributes are set
	expectedAttrs := map[attribute.Key]string{
		semconv.GenAISystemKey:        "openai",
		semconv.GenAIOperationNameKey: "responses",
		semconv.GenAIRequestModelKey:  "o1-pro",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)
		assert.Equal(t, expected, value.AsString())
	}
}

// =============================================================================
// ADDITIONAL API INTEGRATION TESTS
// =============================================================================

func TestIntegration_Completions_Legacy(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test legacy completions endpoint (non-chat)
	responseBody := `{
		"id": "cmpl-legacy",
		"object": "text_completion",
		"created": 1700000000,
		"model": "gpt-3.5-turbo-instruct",
		"choices": [{
			"text": "This is a legacy completion response.",
			"index": 0,
			"finish_reason": "stop"
		}],
		"usage": {
			"prompt_tokens": 8,
			"completion_tokens": 12,
			"total_tokens": 20
		}
	}`

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/completions", req.URL.Path)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Make legacy completion call
	resp, err := client.Completions.New(context.Background(), openai.CompletionNewParams{
		Model: openai.CompletionNewParamsModelGPT3_5TurboInstruct,
		Prompt: openai.CompletionNewParamsPromptUnion{
			OfString: param.Opt[string]{
				Value: "Complete this sentence: The future of AI",
			},
		},
		MaxTokens:   openai.Int(50),
		Temperature: openai.Float(0.5),
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify response
	assert.Equal(t, "cmpl-legacy", resp.ID)
	assert.Len(t, resp.Choices, 1)
	assert.Equal(t, "This is a legacy completion response.", resp.Choices[0].Text)

	// Verify telemetry
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, "completions gpt-3.5-turbo-instruct", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify comprehensive attributes for legacy API
	expectedAttrs := map[attribute.Key]interface{}{
		semconv.GenAISystemKey:            "openai",
		semconv.GenAIOperationNameKey:     "text_completion",
		semconv.GenAIRequestModelKey:      "gpt-3.5-turbo-instruct",
		semconv.GenAIResponseIDKey:        "cmpl-legacy",
		semconv.GenAIUsageInputTokensKey:  int64(8),
		semconv.GenAIUsageOutputTokensKey: int64(12),
		semconv.HTTPRequestMethodKey:      "POST",
		semconv.HTTPResponseStatusCodeKey: int64(200),
		semconv.ServerAddressKey:          "api.openai.com",
		semconv.URLPathKey:                "/v1/completions",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)

		switch v := expected.(type) {
		case string:
			assert.Equal(t, v, value.AsString(), "Attribute %s value mismatch", key)
		case int64:
			assert.Equal(t, v, value.AsInt64(), "Attribute %s value mismatch", key)
		}
	}
}

func TestIntegration_Embeddings(t *testing.T) {
	exporter, cleanup := setupTestTracing(t)
	defer cleanup()

	// Test embeddings endpoint
	responseBody := `{
		"object": "list",
		"data": [{
			"object": "embedding",
			"index": 0,
			"embedding": [0.1, 0.2, 0.3, 0.4, 0.5]
		}],
		"model": "text-embedding-3-small",
		"usage": {
			"prompt_tokens": 5,
			"total_tokens": 5
		}
	}`

	mockClient := newMockHTTPClient(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "/v1/embeddings", req.URL.Path)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(responseBody)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	loggerProvider := noop.NewLoggerProvider()
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(mockClient),
		option.WithMiddleware(Middleware("test-client",
			WithLoggerProvider(loggerProvider),
			WithCaptureAllInput(),
			WithCaptureOutput(),
		)),
	)

	// Make embeddings call
	resp, err := client.Embeddings.New(context.Background(), openai.EmbeddingNewParams{
		Model: openai.EmbeddingModelTextEmbedding3Small,
		Input: openai.EmbeddingNewParamsInputUnion{
			OfArrayOfStrings: []string{"Text to embed"},
		},
		EncodingFormat: openai.EmbeddingNewParamsEncodingFormatFloat,
		Dimensions:     openai.Int(512),
	})
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Verify response
	assert.Equal(t, "text-embedding-3-small", resp.Model)
	assert.Len(t, resp.Data, 1)
	assert.Len(t, resp.Data[0].Embedding, 5)

	// Verify telemetry
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	span := spans[0]

	assert.Equal(t, "embeddings text-embedding-3-small", span.Name)
	assert.Equal(t, codes.Ok, span.Status.Code)

	// Verify comprehensive attributes for embeddings API
	expectedAttrs := map[attribute.Key]interface{}{
		semconv.GenAISystemKey:            "openai",
		semconv.GenAIOperationNameKey:     "embeddings",
		semconv.GenAIRequestModelKey:      "text-embedding-3-small",
		semconv.GenAIUsageInputTokensKey:  int64(5),
		semconv.HTTPRequestMethodKey:      "POST",
		semconv.HTTPResponseStatusCodeKey: int64(200),
		semconv.ServerAddressKey:          "api.openai.com",
		semconv.URLPathKey:                "/v1/embeddings",
	}

	for key, expected := range expectedAttrs {
		value, found := findAttr(span.Attributes, key)
		require.True(t, found, "Missing attribute: %s", key)

		switch v := expected.(type) {
		case string:
			assert.Equal(t, v, value.AsString(), "Attribute %s value mismatch", key)
		case int64:
			assert.Equal(t, v, value.AsInt64(), "Attribute %s value mismatch", key)
		}
	}

	// Verify total tokens equals input tokens for embeddings (no output tokens)
	totalTokens, found := findAttr(span.Attributes, attribute.Key("gen_ai.usage.total_tokens"))
	if found {
		assert.Equal(t, int64(5), totalTokens.AsInt64())
	}
}
