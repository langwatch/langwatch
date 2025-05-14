package langwatch

import (
	"net/http"
	"os"
)

type ClientOption func(*client)

// WithEndpointURL sets a custom endpoint URL for the client. By default
// `defaultEndpointURL` is used.
func WithEndpointURL(endpoint string) ClientOption {
	return func(c *client) {
		c.endpointURL = endpoint
	}
}

// WithAPIKey sets the API key for the client.
func WithAPIKey(apiKey string) ClientOption {
	return func(c *client) {
		c.apiKey = apiKey
	}
}

// WithEnvironmentApiKey sets the API key for the client from an environment variable.
func WithEnvironmentApiKey(environmentVariable string) ClientOption {
	return func(c *client) {
		c.apiKey = os.Getenv(environmentVariable)
	}
}

// WithHTTPClient sets the http client for the client.
func WithHTTPClient(httpClient *http.Client) ClientOption {
	return func(c *client) {
		c.httpClient = httpClient
	}
}
