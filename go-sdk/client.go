package langwatch

import (
	"context"
	"errors"
	"net/http"
	"os"
)

const (
	defaultEndpointURL                   = "https://app.langwatch.ai"
	defaultAPIKeyEnvironmentVariableName = "LANGWATCH_API_KEY"
)

type client struct {
	endpointURL string
	apiKey      string
	httpClient  *http.Client
}

type Client interface {
	AddEvaluation(ctx context.Context) error
	Evaluate(ctx context.Context) error
}

func NewClient(opts ...ClientOption) Client {
	c := &client{
		endpointURL: defaultEndpointURL,
		apiKey:      os.Getenv(defaultAPIKeyEnvironmentVariableName),
		httpClient:  &http.Client{},
	}

	for _, opt := range opts {
		opt(c)
	}

	return c
}

func (c *client) AddEvaluation(ctx context.Context) error {
	return errors.New("not implemented")
}

func (c *client) Evaluate(ctx context.Context) error {
	return errors.New("not implemented")
}
