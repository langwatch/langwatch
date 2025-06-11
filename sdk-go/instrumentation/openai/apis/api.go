package apis

import (
	"context"
	"io"
	"net/http"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// API defines the common interface for all OpenAI API domain handlers
type API interface {
	// ProcessRequest handles the request processing for this API domain
	ProcessRequest(ctx context.Context, req *http.Request, span *langwatch.Span, operation string) (bool, error)

	// ProcessResponse handles the response processing for this API domain
	ProcessResponse(ctx context.Context, resp *http.Response, span *langwatch.Span, isStreaming bool) (io.ReadCloser, error)
}
