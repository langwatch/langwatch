package chatcompletions

import (
	"context"
	"io"
	"log/slog"
	"net/http"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	otellog "go.opentelemetry.io/otel/log"
)

// API handles all Chat Completions API operations
type API struct {
	genAISystemName   string
	requestProcessor  *RequestProcessor
	responseProcessor *ResponseProcessor
	slogger           *slog.Logger
}

// NewAPI creates a new Chat Completions API handler
func NewAPI(
	genAISystemName string,
	contentRecordPolicy events.RecordPolicy,
	loggerProvider otellog.LoggerProvider,
	slogger *slog.Logger,
) *API {
	logger := loggerProvider.Logger("github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/chatcompletions")

	return &API{
		genAISystemName:   genAISystemName,
		requestProcessor:  NewRequestProcessor(genAISystemName, contentRecordPolicy, logger, slogger),
		responseProcessor: NewResponseProcessor(contentRecordPolicy, logger, slogger),
		slogger:           slogger,
	}
}

// ProcessRequest handles Chat Completions API request processing
func (a *API) ProcessRequest(ctx context.Context, req *http.Request, span *langwatch.Span, operation string) (bool, error) {
	return a.requestProcessor.Process(ctx, req, span, operation)
}

// ProcessResponse handles Chat Completions API response processing
func (a *API) ProcessResponse(ctx context.Context, resp *http.Response, span *langwatch.Span, isStreaming bool) (io.ReadCloser, error) {
	if isStreaming {
		return a.responseProcessor.ProcessStreaming(ctx, resp, span)
	}
	return a.responseProcessor.ProcessNonStreaming(ctx, resp, span)
}
