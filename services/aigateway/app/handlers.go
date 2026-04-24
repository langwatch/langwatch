package app

import (
	"context"
	"io"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type DispatchMeta = pipeline.Meta
type CompletionResult = pipeline.SyncResult
type StreamResult = pipeline.StreamResult
type EmbeddingResult = pipeline.SyncResult

func (a *App) HandleChat(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeChat, Model: model, BodyReader: body})
}

func (a *App) HandleChatStream(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, &domain.Request{Type: domain.RequestTypeChat, Model: model, BodyReader: body})
}

func (a *App) HandleMessages(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeMessages, Model: model, BodyReader: body})
}

func (a *App) HandleMessagesStream(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, &domain.Request{Type: domain.RequestTypeMessages, Model: model, BodyReader: body})
}

func (a *App) HandleResponses(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*CompletionResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeResponses, Model: model, BodyReader: body})
}

func (a *App) HandleResponsesStream(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*StreamResult, error) {
	return a.pipeline.Stream(ctx, bundle, &domain.Request{Type: domain.RequestTypeResponses, Model: model, BodyReader: body})
}

func (a *App) HandleEmbeddings(ctx context.Context, bundle *domain.Bundle, body io.Reader, model string) (*EmbeddingResult, error) {
	return a.pipeline.Sync(ctx, bundle, &domain.Request{Type: domain.RequestTypeEmbeddings, Model: model, BodyReader: body})
}

func PeekStream(body []byte) bool {
	return gjson.GetBytes(body, "stream").Bool()
}

func PeekModel(body []byte) string {
	return gjson.GetBytes(body, "model").String()
}
