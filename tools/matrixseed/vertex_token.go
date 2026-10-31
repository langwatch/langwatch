package matrixseed

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// vertexScope is what the Vertex cache cell calls with its bearer token.
const vertexScope = "https://www.googleapis.com/auth/cloud-platform"

// mintVertexToken exchanges a service-account key for an access token at the
// key's own token_uri.
func mintVertexToken(ctx context.Context, hc *http.Client, keyJSON string) (string, error) {
	conf, err := google.JWTConfigFromJSON([]byte(keyJSON), vertexScope)
	if err != nil {
		return "", fmt.Errorf("reading the service-account key: %w", err)
	}
	tok, err := conf.TokenSource(context.WithValue(ctx, oauth2.HTTPClient, hc)).Token()
	if err != nil {
		return "", fmt.Errorf("exchanging the service-account key: %w", err)
	}
	if tok.AccessToken == "" {
		return "", errors.New("the token endpoint answered no access_token")
	}
	return tok.AccessToken, nil
}
