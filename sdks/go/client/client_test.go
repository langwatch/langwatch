package client

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestClient spins up an httptest server with the given handler and returns a
// Client pointed at it, plus a cleanup. Extra options are appended after the
// endpoint/key defaults so individual tests can override them.
func newTestClient(t *testing.T, handler http.HandlerFunc, opts ...Option) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	base := []Option{
		WithEndpoint(srv.URL),
		WithAPIKey("sk-lw-test-key"),
	}
	c, err := New(append(base, opts...)...)
	require.NoError(t, err)
	return c
}

func TestNew(t *testing.T) {
	t.Run("given explicit options", func(t *testing.T) {
		t.Run("when constructing", func(t *testing.T) {
			c, err := New(
				WithAPIKey("sk-lw-abc"),
				WithProjectID("project_x"),
				WithEndpoint("https://example.test"),
			)
			require.NoError(t, err)

			assert.Equal(t, "https://example.test", c.Endpoint())
			assert.Equal(t, "sk-lw-abc", c.cfg.apiKey)
			assert.Equal(t, "project_x", c.cfg.projectID)
			assert.NotNil(t, c.Prompts)
			assert.NotNil(t, c.Datasets)
			assert.NotNil(t, c.Traces)
			assert.NotNil(t, c.Annotations)
			assert.NotNil(t, c.Events)
			assert.NotNil(t, c.Evaluations)
			assert.NotNil(t, c.Triggers)
			assert.NotNil(t, c.Monitors)
			assert.NotNil(t, c.Scenarios)
			assert.NotNil(t, c.Projects)
		})
	})

	t.Run("given no endpoint option and no env", func(t *testing.T) {
		t.Run("when constructing", func(t *testing.T) {
			t.Setenv("LANGWATCH_ENDPOINT", "")
			c, err := New(WithAPIKey("sk-lw-abc"))
			require.NoError(t, err)
			assert.Equal(t, DefaultEndpoint, c.Endpoint())
		})
	})

	t.Run("given environment variables and no options", func(t *testing.T) {
		t.Run("when constructing", func(t *testing.T) {
			t.Setenv("LANGWATCH_API_KEY", "sk-lw-from-env")
			t.Setenv("LANGWATCH_PROJECT_ID", "project_env")
			t.Setenv("LANGWATCH_ENDPOINT", "https://env.example")

			c, err := New()
			require.NoError(t, err)
			assert.Equal(t, "sk-lw-from-env", c.cfg.apiKey)
			assert.Equal(t, "project_env", c.cfg.projectID)
			assert.Equal(t, "https://env.example", c.Endpoint())
		})
	})

	t.Run("given both env and an explicit option", func(t *testing.T) {
		t.Run("when constructing", func(t *testing.T) {
			t.Setenv("LANGWATCH_API_KEY", "sk-lw-from-env")
			c, err := New(WithAPIKey("sk-lw-explicit"))
			require.NoError(t, err)
			assert.Equal(t, "sk-lw-explicit", c.cfg.apiKey, "explicit option wins over env")
		})
	})
}

func TestAuthHeaders(t *testing.T) {
	t.Run("given a legacy sk-lw key", func(t *testing.T) {
		t.Run("when a request is made", func(t *testing.T) {
			var got http.Header
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Clone()
				_, _ = w.Write([]byte(`[]`))
			}, WithAPIKey("sk-lw-legacy"))

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)

			assert.Equal(t, "Bearer sk-lw-legacy", got.Get("Authorization"))
			assert.Empty(t, got.Get("X-Auth-Token"), "the legacy header is no longer sent")
		})
	})

	t.Run("given a PAT with a project id", func(t *testing.T) {
		t.Run("when a request is made", func(t *testing.T) {
			var got http.Header
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Clone()
				_, _ = w.Write([]byte(`[]`))
			}, WithAPIKey("pat-lw-secret"), WithProjectID("project_abc"))

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)

			assert.Equal(t, "Bearer pat-lw-secret", got.Get("Authorization"))
			assert.Equal(t, "project_abc", got.Get("X-Project-Id"))
		})
	})

	t.Run("given a PAT without a project id", func(t *testing.T) {
		t.Run("when a request is made", func(t *testing.T) {
			t.Setenv("LANGWATCH_PROJECT_ID", "")
			var got http.Header
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Clone()
				_, _ = w.Write([]byte(`[]`))
			}, WithAPIKey("pat-lw-secret"))

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)

			assert.Equal(t, "Bearer pat-lw-secret", got.Get("Authorization"))
			assert.Empty(t, got.Get("X-Project-Id"), "no project id is sent when none is provided")
		})
	})

	t.Run("given a PAT and project id from the environment", func(t *testing.T) {
		t.Run("when a request is made", func(t *testing.T) {
			t.Setenv("LANGWATCH_PROJECT_ID", "project_from_env")
			var got http.Header
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Clone()
				_, _ = w.Write([]byte(`[]`))
			}, WithAPIKey("pat-lw-secret"))

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)

			assert.Equal(t, "Bearer pat-lw-secret", got.Get("Authorization"))
			assert.Equal(t, "project_from_env", got.Get("X-Project-Id"),
				"project id is picked up from LANGWATCH_PROJECT_ID")
		})
	})
}

func TestSDKHeaders(t *testing.T) {
	t.Run("given any request", func(t *testing.T) {
		t.Run("when it is sent", func(t *testing.T) {
			var got http.Header
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Clone()
				_, _ = w.Write([]byte(`[]`))
			})

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)

			assert.Equal(t, "langwatch-sdk-go", got.Get("X-Langwatch-Sdk-Name"))
			assert.Equal(t, "go", got.Get("X-Langwatch-Sdk-Language"))
			assert.NotEmpty(t, got.Get("X-Langwatch-Sdk-Version"))
			assert.Contains(t, got.Get("User-Agent"), "langwatch-sdk-go/")
		})
	})

	t.Run("given a custom user agent", func(t *testing.T) {
		t.Run("when a request is sent", func(t *testing.T) {
			var got http.Header
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				got = r.Header.Clone()
				_, _ = w.Write([]byte(`[]`))
			}, WithUserAgent("my-app/2.0"))

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)
			assert.Equal(t, "my-app/2.0", got.Get("User-Agent"))
		})
	})
}

func TestContextCancellation(t *testing.T) {
	t.Run("given a context cancelled before the response arrives", func(t *testing.T) {
		t.Run("when a request is made", func(t *testing.T) {
			release := make(chan struct{})
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				<-release // block until the test lets go
				_, _ = w.Write([]byte(`[]`))
			})
			t.Cleanup(func() { close(release) })

			ctx, cancel := context.WithCancel(context.Background())
			cancel() // already cancelled

			_, err := c.Prompts.List(ctx)
			require.Error(t, err)
			assert.ErrorIs(t, err, context.Canceled)
		})
	})

	t.Run("given a context deadline", func(t *testing.T) {
		t.Run("when the server is slower than the deadline", func(t *testing.T) {
			release := make(chan struct{})
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				<-release
				_, _ = w.Write([]byte(`[]`))
			})
			t.Cleanup(func() { close(release) })

			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			defer cancel()

			_, err := c.Prompts.List(ctx)
			require.Error(t, err)
			assert.ErrorIs(t, err, context.DeadlineExceeded)
		})
	})
}
