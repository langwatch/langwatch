package apis

import (
	"context"
	"io"
	"log/slog"
	"net/http"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	otellog "go.opentelemetry.io/otel/log"
)

// Processor is the main API processor that uses the router to delegate requests
type Processor struct {
	router *Router
}

// NewProcessor creates a new processor with a configured router
func NewProcessor(
	genAISystemName string,
	contentRecordPolicy events.RecordPolicy,
	loggerProvider otellog.LoggerProvider,
	logger *slog.Logger,
) *Processor {
	return &Processor{
		router: NewRouter(genAISystemName, contentRecordPolicy, loggerProvider, logger),
	}
}

// ProcessRequest replaces the original RequestProcessor.ProcessRequest with clean domain routing
func (p *Processor) ProcessRequest(ctx context.Context, req *http.Request, span *langwatch.Span) (bool, error) {
	return p.router.RouteRequest(ctx, req, span)
}

// ProcessResponse replaces the original ResponseProcessor with clean domain routing
func (p *Processor) ProcessResponse(ctx context.Context, resp *http.Response, span *langwatch.Span, isStreaming bool) (io.ReadCloser, error) {
	return p.router.RouteResponse(ctx, resp, span, isStreaming)
}
