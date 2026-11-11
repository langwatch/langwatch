package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	)

	require.Nil(t, nodeErr)
	require.NotNil(t, ns.HTTP, "the node records what it saw on the wire")
	assert.Equal(t, 200, ns.HTTP.StatusCode)
	assert.Equal(t, "OK", ns.HTTP.StatusText)
	assert.Contains(t, ns.HTTP.ResponseHeaders["Content-Type"], "application/json",
		"response headers reach the author")
}

// A non-2xx is the case the author most needs to read: the endpoint's own
// complaint, with the secrets they sent redacted from it.
func TestRunHTTP_KeepsTheUpstreamBodyOfANon2xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"detail":"quota exceeded for s3cr3t"}`))
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
		map[string]string{"KEY": "s3cr3t"},
	)

	require.NotNil(t, nodeErr)
	assert.Equal(t, "upstream_http_error", nodeErr.Type)
	require.NotNil(t, ns.HTTP)
	assert.JSONEq(t, `{"detail":"quota exceeded for [redacted]"}`, ns.HTTP.ResponseBody)
}

// An endpoint that answered 200 was reached. When its reply has nothing at the
// output path, the code must say so; reported as http_error it read "couldn't
// reach the agent, check the URL", which sends the author to the wrong field.
// @scenario "An HTTP agent reply with nothing at the output path names the output path"
func TestRunHTTP_OutputPathMatchingNothingReportsItsOwnCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"present":"value"}`))
	}))
	defer srv.Close()

	eng := New(Options{
		HTTP: httpblock.New(httpblock.Options{
			SSRF: httpblock.SSRFOptions{AllowLocal: true},
		}),
	})

	node := httpNode(srv.URL)
	node.Data.Parameters = append(node.Data.Parameters, stringField("output_path", "$.missing"))

	ns := &NodeState{ID: "http"}
	_, nodeErr := eng.runHTTP(context.Background(), node, map[string]any{}, ns, nil)

	require.NotNil(t, nodeErr)
	assert.Equal(t, "jsonpath_no_match", nodeErr.Type)
	assert.Equal(t, faultCustomer, classifyNodeFault(nodeErr),
		"an output path the author set is theirs to fix, not a platform fault")
	require.NotNil(t, ns.HTTP, "the reply the path was read against still reaches the author")
	assert.Equal(t, 200, ns.HTTP.StatusCode)
	assert.JSONEq(t, `{"present":"value"}`, ns.HTTP.ResponseBody,
		"the body the path missed is what the author reads to correct it")
}
