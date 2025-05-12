package otelopenai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"

	oaioption "github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
	"go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/go-sdk"
)

const (
	tracerName             = "github.com/langwatch/go-sdk/instrumentation/otelopenai"
	instrumentationVersion = "0.0.1" // TODO: Consider linking this to package version
)

// Middleware sets up a handler to start tracing the requests made to OpenAI by the
// OpenAI library.
func Middleware(name string, opts ...Option) oaioption.Middleware {
	cfg := config{}
	for _, opt := range opts {
		opt.apply(&cfg)
	}
	if cfg.tracerProvider == nil {
		cfg.tracerProvider = otel.GetTracerProvider()
	}
	tracerOpts := []trace.TracerOption{
		trace.WithInstrumentationVersion(instrumentationVersion),
		trace.WithSchemaURL(semconv.SchemaURL),
	}

	tracer := langwatch.Tracer(tracerName, tracerOpts...)

	if cfg.propagators == nil {
		cfg.propagators = otel.GetTextMapPropagator()
	}

	return func(req *http.Request, next oaioption.MiddlewareNext) (*http.Response, error) {
		customSpanEndHandling := false
		operation := path.Base(req.URL.Path)
		spanName := "openai." + operation
		ctx, span := tracer.Start(req.Context(), spanName,
			trace.WithAttributes(
				semconv.HTTPRequestMethodKey.String(req.Method),
				semconv.ServerAddressKey.String(req.URL.Hostname()),
				semconv.URLPathKey.String(req.URL.Path),
				semconv.GenAISystemOpenai,
				semconv.GenAIOperationNameChat, // TODO(afr): This is not correct, we need to set this based on the url
			),
			trace.WithSpanKind(trace.SpanKindClient),
		)
		defer func() {
			if !customSpanEndHandling {
				span.End()
			}
		}()

		var reqBody []byte
		var isStreaming bool
		if req.Body != nil && req.Body != http.NoBody {
			var errRead error
			reqBody, errRead = io.ReadAll(req.Body)
			// Important!: We need to restore the body so the downstream handler can read it
			req.Body = io.NopCloser(bytes.NewBuffer(reqBody))
			if errRead == nil {
				var reqData jsonData
				if err := json.Unmarshal(reqBody, &reqData); err == nil {
					setRequestAttributes(span, reqData, operation, cfg.recordInput, reqBody)
					if streamVal, ok := reqData["stream"].(bool); ok && streamVal {
						isStreaming = true
						span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(true))
					} else {
						span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(false))
					}
				} else {
					log.Default().Printf("Failed to parse OpenAI request body JSON: %v", err)
				}
			} else {
				log.Default().Printf("Failed to read OpenAI request body: %v", errRead)
			}
		}

		resp, err := next(req.WithContext(ctx))
		if err != nil {
			span.SetStatus(codes.Error, err.Error())
			span.RecordError(err)
			if resp != nil {
				span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
			}
			return resp, err
		}

		if resp != nil {
			span.SetAttributes(semconv.HTTPResponseStatusCodeKey.Int(resp.StatusCode))
			if resp.StatusCode >= 400 {
				// TODO(afr): Should we read the error here? I think so!
				span.SetStatus(codes.Error, http.StatusText(resp.StatusCode))
			} else {
				span.SetStatus(codes.Ok, "")
			}

			if resp.Body != nil && resp.Body != http.NoBody {
				if isStreaming {
					// Handle streaming response body
					pr, pw := io.Pipe()
					originalBody := resp.Body
					resp.Body = pr // Client will read from this pipe reader

					customSpanEndHandling = true
					go func() {
						// Ensure original body and pipe writer are closed when goroutine exits
						defer originalBody.Close()
						defer pw.Close()
						defer span.End()

						state := &streamProcessingState{}

						scanner := bufio.NewScanner(originalBody)
						for scanner.Scan() {
							lineBytes := scanner.Bytes()
							// Write the current line (event) to the pipe for the client
							if _, err := pw.Write(append(lineBytes, '\n')); err != nil {
								log.Default().Printf("Error writing to response pipe: %v", err)
								log.Default().Panicln("Failed to write to response pipe", err)
								return
							}

							line := string(lineBytes)
							if strings.HasPrefix(line, "data: ") {
								jsonDataStr := strings.TrimPrefix(line, "data: ")
								if jsonDataStr == "" { // Skip empty data lines (e.g. SSE comments or keep-alives)
									continue
								}
								if jsonDataStr == "[DONE]" { // Stream finished
									break
								}

								var eventData jsonData
								if errUnmarshal := json.Unmarshal([]byte(jsonDataStr), &eventData); errUnmarshal == nil {
									setStreamEventAttributes(span, eventData, state, cfg.recordOutput)
								} else {
									log.Default().Printf("Failed to parse stream event JSON. Error: %v. Data: %s", errUnmarshal, jsonDataStr)
								}
							}
						}

						if errScan := scanner.Err(); errScan != nil {
							log.Default().Printf("Error reading streaming response body: %v", errScan)
						}

						setAggregatedStreamAttributes(span, state, cfg.recordOutput)
					}()
				} else {
					// Handle non-streaming response body
					respBody, errRead := io.ReadAll(resp.Body)
					// Restore the *response* body so the client can read it
					resp.Body = io.NopCloser(bytes.NewBuffer(respBody))
					if errRead == nil {
						contentType := resp.Header.Get("Content-Type")
						if strings.HasPrefix(contentType, "application/json") {
							var respData jsonData
							if cfg.recordOutput {
								span.RecordOutput(respData)
							}
							if err := json.Unmarshal(respBody, &respData); err == nil {
								setNonStreamResponseAttributes(span, respData)
							} else {
								log.Default().Printf("Failed to parse non-stream OpenAI response body JSON: %v", err)
							}
						}
					} else {
						log.Default().Printf("Failed to read non-stream OpenAI response body: %v", errRead)
					}
				}
			}
		}

		return resp, nil
	}
}

// streamProcessingState holds variables that are updated during stream processing.
type streamProcessingState struct {
	id                string
	model             string
	systemFingerprint string
	finishReasons     []string
	accumulatedOutput strings.Builder
	usageDataFound    bool
	promptTokens      int
	completionTokens  int
	totalTokens       int
	inputRecorded     bool // to ensure input is recorded only once if present in stream
	outputRecorded    bool // to ensure output is recorded only once if present in stream
}

// setRequestAttributes sets attributes on the span based on the initial OpenAI request data.
func setRequestAttributes(span *langwatch.Span, reqData jsonData, operation string, recordInput bool, rawReqBody []byte) {
	if recordInput {
		// Record the raw request body first if configured.
		// Avoids double-recording if messages are also explicitly recorded.
		span.RecordInput(rawReqBody)
	}

	if model, ok := getString(reqData, "model"); ok {
		span.SetRequestModel(model)
		span.SetName(fmt.Sprintf("openai.%s.%s", operation, model))
	}
	if temp, ok := getFloat64(reqData, "temperature"); ok {
		span.SetAttributes(semconv.GenAIRequestTemperature(temp))
	}
	if topP, ok := getFloat64(reqData, "top_p"); ok {
		span.SetAttributes(semconv.GenAIRequestTopP(topP))
	}
	if topK, ok := getFloat64(reqData, "top_k"); ok {
		span.SetAttributes(semconv.GenAIRequestTopK(topK))
	}
	if freqPenalty, ok := getFloat64(reqData, "frequency_penalty"); ok {
		span.SetAttributes(semconv.GenAIRequestFrequencyPenalty(freqPenalty))
	}
	if presPenalty, ok := getFloat64(reqData, "presence_penalty"); ok {
		span.SetAttributes(semconv.GenAIRequestPresencePenalty(presPenalty))
	}
	if maxTokens, ok := getInt(reqData, "max_tokens"); ok {
		span.SetAttributes(semconv.GenAIRequestMaxTokens(maxTokens))
	}
	if messages, ok := reqData["messages"]; ok && recordInput {
		// If messages are present and recordInput is true, record them specifically.
		// This might be redundant if the whole body is already recorded,
		// but provides more specific input if desired.
		span.RecordInput(messages)
	}
}

// setStreamEventAttributes sets attributes on the span based on a single SSE event from OpenAI.
// It updates the streamProcessingState with data from the event.
func setStreamEventAttributes(span *langwatch.Span, eventData jsonData, state *streamProcessingState, recordOutput bool) {
	if id, ok := getString(eventData, "id"); ok && state.id == "" {
		state.id = id
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := getString(eventData, "model"); ok && state.model == "" {
		state.model = model
		span.SetAttributes(semconv.GenAIResponseModel(model))
	}
	if sysFingerprint, ok := getString(eventData, "system_fingerprint"); ok && state.systemFingerprint == "" {
		state.systemFingerprint = sysFingerprint
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(sysFingerprint))
	}

	if choices, ok := eventData["choices"].([]any); ok {
		for _, choiceRaw := range choices {
			if choice, choiceOk := choiceRaw.(jsonData); choiceOk {
				if reason, reasonOk := getString(choice, "finish_reason"); reasonOk && reason != "" {
					state.finishReasons = append(state.finishReasons, reason)
				}
				if delta, deltaOk := choice["delta"].(jsonData); deltaOk {
					if content, contentOk := getString(delta, "content"); contentOk {
						if recordOutput {
							state.accumulatedOutput.WriteString(content)
						}
					}
				}
			}
		}
	}

	// Check for usage object, which typically appears at the end of a stream with Azure OpenAI,
	// or sometimes in the last regular data event for OpenAI.
	if usage, usageOk := eventData["usage"].(jsonData); usageOk && !state.usageDataFound {
		if pt, ptOk := getInt(usage, "prompt_tokens"); ptOk {
			state.promptTokens = pt
			span.SetAttributes(semconv.GenAIUsageInputTokens(pt))
		}
		if ct, ctOk := getInt(usage, "completion_tokens"); ctOk {
			state.completionTokens = ct
			span.SetAttributes(semconv.GenAIUsageOutputTokens(ct))
		}
		if rt, rtOk := getInt(usage, "total_tokens"); rtOk {
			state.totalTokens = rt
		}
		state.usageDataFound = true
	}
}

// setAggregatedStreamAttributes sets the final attributes on the span after stream processing is complete.
func setAggregatedStreamAttributes(span *langwatch.Span, state *streamProcessingState, recordOutput bool) {
	if len(state.finishReasons) > 0 {
		uniqueReasons := make(map[string]struct{})
		var finalReasons []string
		for _, r := range state.finishReasons {
			if _, exists := uniqueReasons[r]; !exists {
				uniqueReasons[r] = struct{}{}
				finalReasons = append(finalReasons, r)
			}
		}
		span.SetAttributes(semconv.GenAIResponseFinishReasons(finalReasons...))
	}

	if recordOutput && state.accumulatedOutput.Len() > 0 && !state.outputRecorded {
		span.RecordOutputString(state.accumulatedOutput.String())
		state.outputRecorded = true
	}
}

// setNonStreamResponseAttributes extracts attributes from a standard JSON response body.
func setNonStreamResponseAttributes(span *langwatch.Span, respData jsonData) {
	if id, ok := getString(respData, "id"); ok {
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := getString(respData, "model"); ok {
		span.SetAttributes(semconv.GenAIResponseModel(model))
	}
	if sysFingerprint, ok := getString(respData, "system_fingerprint"); ok {
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(sysFingerprint))
	}
	if usage, ok := respData["usage"].(jsonData); ok {
		if promptTokens, ok := getInt(usage, "prompt_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageInputTokens(promptTokens))
		}
		if completionTokens, ok := getInt(usage, "completion_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageOutputTokens(completionTokens))
		}
	}
	if choices, ok := respData["choices"].([]any); ok {
		finishReasons := make([]string, 0, len(choices))
		for _, choiceRaw := range choices {
			if choice, ok := choiceRaw.(jsonData); ok {
				if reason, ok := getString(choice, "finish_reason"); ok {
					finishReasons = append(finishReasons, reason)
				}
			}
		}
		if len(finishReasons) > 0 {
			span.SetAttributes(semconv.GenAIResponseFinishReasons(finishReasons...))
		}
	}
}
