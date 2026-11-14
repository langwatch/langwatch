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
// key's own token_uri. Its errors never carry the key or the endpoint's body,
// which can echo what was sent: a refusal keeps only the HTTP status.
func mintVertexToken(ctx context.Context, hc *http.Client, keyJSON string) (string, error) {
	conf, err := google.JWTConfigFromJSON([]byte(keyJSON), vertexScope)
	if err != nil {
		return "", errors.New("the service-account key is not a valid key JSON")
	}
	tok, err := conf.TokenSource(context.WithValue(ctx, oauth2.HTTPClient, hc)).Token()
	if err != nil {
		var refused *oauth2.RetrieveError
		if errors.As(err, &refused) && refused.Response != nil {
			return "", fmt.Errorf("the token endpoint refused the service-account key (HTTP %d)", refused.Response.StatusCode)
		}
		return "", errors.New("the service-account key could not be exchanged for a token")
	}
	if tok.AccessToken == "" {
		return "", errors.New("the token endpoint answered no access_token")
	}
	return tok.AccessToken, nil
}
