package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

func stringField(identifier, value string) dsl.Field {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return dsl.Field{Identifier: identifier, Type: "str", Value: raw}
}

func httpNode(url string) *dsl.Node {
	name := "agent"
	return &dsl.Node{
		ID:   "http",
		Type: "http",
		Data: dsl.Component{
			Name: &name,
			Parameters: []dsl.Field{
				stringField("url", url),
				stringField("method", http.MethodGet),
			},
		},
	}
}

// A refused destination is not a failure to reach one. Reported as http_error
// it presents to the author as "couldn't reach the agent, check the URL and
// that the service is running", which is advice about an endpoint that is
// running fine and was never dialed.
func TestRunHTTP_RefusedDestinationReportsItsOwnCode(t *testing.T) {
	eng := New(Options{
		HTTP: httpblock.New(httpblock.Options{
			SSRF: httpblock.SSRFOptions{}, // local destinations refused
		}),
	})

	ns := &NodeState{ID: "http"}
	_, nodeErr := eng.runHTTP(
		context.Background(),
		httpNode("http://127.0.0.1:9/x"),
		map[string]any{},
		ns,
		nil,
		nil,
	)

	require.NotNil(t, nodeErr)
	assert.Equal(t, "ssrf_blocked", nodeErr.Type,
		"the code names what happened, and it is the one the copy is written for")
}

// The counterpart: a destination the deployment permits, where the endpoint's
// own answer is what the author needs to see.
func TestRunHTTP_RecordsWhatTheEndpointAnswered(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"answer":"ok"}`))
	}))
	defer srv.Close()

	eng := New(Options{
		HTTP: httpblock.New(httpblock.Options{
			SSRF: httpblock.SSRFOptions{AllowLocal: true},
		}),
	})

	ns := &NodeState{ID: "http"}
	_, nodeErr := eng.runHTTP(
		context.Background(),
		httpNode(srv.URL),
		map[string]any{},
		ns,
		nil,
		nil,
	)

	require.Nil(t, nodeErr)
	require.NotNil(t, ns.HTTP, "the node records what it saw on the wire")
	assert.Equal(t, 200, ns.HTTP.StatusCode)
	assert.Equal(t, "OK", ns.HTTP.StatusText)
	assert.Contains(t, ns.HTTP.ResponseHeaders["Content-Type"], "application/json",
		"response headers reach the author")
}

// A secret minted from an HTTP credential is bound to the origin it was saved
// for. A node that would send it anywhere else is refused before any dial.
func TestRunHTTP_RefusesABoundSecretSentToAnotherOrigin(t *testing.T) {
	var dialed atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		dialed.Store(true)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	eng := New(Options{
		HTTP: httpblock.New(httpblock.Options{
			SSRF: httpblock.SSRFOptions{AllowLocal: true},
		}),
	})
	node := httpNode(srv.URL + "/?key={{ secrets.HTTP_AGENT_KEY }}")
	secrets := map[string]string{"HTTP_AGENT_KEY": "k-123"}

	t.Run("when the node calls another origin it refuses by code", func(t *testing.T) {
		ns := &NodeState{ID: "http"}
		origins := map[string]string{"HTTP_AGENT_KEY": "https://agent.example.com"}

		_, nodeErr := eng.runHTTP(context.Background(), node, map[string]any{}, ns, secrets, origins)

		require.NotNil(t, nodeErr)
		assert.Equal(t, "agent_stored_credentials_destination_mismatch", nodeErr.Type)
		assert.False(t, dialed.Load(), "the endpoint is never dialed")
	})

	t.Run("when the node calls the bound origin it sends the request", func(t *testing.T) {
		ns := &NodeState{ID: "http"}
		origins := map[string]string{"HTTP_AGENT_KEY": srv.URL}

		_, nodeErr := eng.runHTTP(context.Background(), node, map[string]any{}, ns, secrets, origins)

		require.Nil(t, nodeErr)
		assert.True(t, dialed.Load())
	})
}
