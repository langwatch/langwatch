package apis

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/chatcompletions"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/generic"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/responses"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	otellog "go.opentelemetry.io/otel/log"
)

// Router routes API requests to the appropriate domain-specific handlers
type Router struct {
	chatCompletionsAPI *chatcompletions.API
	responsesAPI       *responses.API
	genericAPI         *generic.API
	slogger            *slog.Logger
}

// NewRouter creates a new API router with domain-specific handlers
func NewRouter(
	genAISystemName string,
	contentRecordPolicy events.RecordPolicy,
	loggerProvider otellog.LoggerProvider,
	slogger *slog.Logger,
) *Router {
	return &Router{
		chatCompletionsAPI: chatcompletions.NewAPI(genAISystemName, contentRecordPolicy, loggerProvider, slogger),
		responsesAPI:       responses.NewAPI(genAISystemName, contentRecordPolicy, loggerProvider, slogger),
		genericAPI:         generic.NewAPI(genAISystemName, contentRecordPolicy, loggerProvider, slogger),
		slogger:            slogger,
	}
}

// RouteRequest determines the appropriate API handler and processes the request
func (r *Router) RouteRequest(ctx context.Context, req *http.Request, span *langwatch.Span) (bool, error) {
	operation := extractOperationFromURL(req.URL.Path)

	switch {
	case isChatCompletionsAPI(operation):
		return r.chatCompletionsAPI.ProcessRequest(ctx, req, span, operation)
	case isResponsesAPI(operation):
		return r.responsesAPI.ProcessRequest(ctx, req, span, operation)
	default:
		return r.genericAPI.ProcessRequest(ctx, req, span, operation)
	}
}

// RouteResponse determines the appropriate API handler and processes the response
func (r *Router) RouteResponse(ctx context.Context, resp *http.Response, span *langwatch.Span, isStreaming bool) (io.ReadCloser, error) {
	var operation string
	if resp.Request != nil && resp.Request.URL != nil {
		operation = extractOperationFromURL(resp.Request.URL.Path)
	}

	switch {
	case isChatCompletionsAPI(operation):
		return r.chatCompletionsAPI.ProcessResponse(ctx, resp, span, isStreaming)
	case isResponsesAPI(operation):
		return r.responsesAPI.ProcessResponse(ctx, resp, span, isStreaming)
	default:
		return r.genericAPI.ProcessResponse(ctx, resp, span, isStreaming)
	}
}

// Helper functions to determine API type
func isChatCompletionsAPI(operation string) bool {
	return operation == "chat/completions" || operation == "completions"
}

func isResponsesAPI(operation string) bool {
	return operation == "responses"
}

// extractOperationFromURL extracts the operation name from the URL path
func extractOperationFromURL(path string) string {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 {
		return ""
	}

	// Handle different URL patterns
	// /v1/chat/completions -> "chat/completions"
	// /v1/completions -> "completions"
	// /v1/responses -> "responses"

	var relevantParts []string
	for i, part := range parts {
		if part == "v1" {
			// Skip version prefix, take everything after
			relevantParts = parts[i+1:]
			break
		}
	}

	if len(relevantParts) == 0 {
		relevantParts = parts
	}

	return strings.Join(relevantParts, "/")
}
