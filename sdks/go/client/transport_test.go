package client

import (
	"context"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRetry(t *testing.T) {
	t.Run("given a server that returns 503 then 200", func(t *testing.T) {
		t.Run("when a request is made with retries enabled", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				if n < 3 {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				_, _ = w.Write([]byte(`[]`))
			},
				WithMaxRetries(3),
				WithRetryWaitMax(5*time.Millisecond),
			)

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)
			assert.Equal(t, int32(3), atomic.LoadInt32(&calls),
				"two 503s should be retried, third 200 succeeds")
		})
	})

	t.Run("given a server that returns 429 with Retry-After", func(t *testing.T) {
		t.Run("when a request is made", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				if n == 1 {
					w.Header().Set("Retry-After", "0")
					w.WriteHeader(http.StatusTooManyRequests)
					return
				}
				_, _ = w.Write([]byte(`[]`))
			},
				WithMaxRetries(2),
				WithRetryWaitMax(5*time.Millisecond),
			)

			_, err := c.Prompts.List(context.Background())
			require.NoError(t, err)
			assert.Equal(t, int32(2), atomic.LoadInt32(&calls))
		})
	})

	t.Run("given retries are disabled", func(t *testing.T) {
		t.Run("when the server returns 503", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				w.WriteHeader(http.StatusServiceUnavailable)
			}, WithMaxRetries(0))

			_, err := c.Prompts.List(context.Background())
			require.Error(t, err)
			assert.Equal(t, int32(1), atomic.LoadInt32(&calls), "no retries when disabled")
			assert.True(t, hasStatus(err, http.StatusServiceUnavailable))
		})
	})

	t.Run("given the server exhausts all retries", func(t *testing.T) {
		t.Run("when every attempt returns 500", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				w.WriteHeader(http.StatusInternalServerError)
			},
				WithMaxRetries(2),
				WithRetryWaitMax(5*time.Millisecond),
			)

			_, err := c.Prompts.List(context.Background())
			require.Error(t, err)
			// initial attempt + 2 retries = 3 calls.
			assert.Equal(t, int32(3), atomic.LoadInt32(&calls))
			var apiErr *APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, http.StatusInternalServerError, apiErr.StatusCode)
		})
	})

	t.Run("given a 4xx client error", func(t *testing.T) {
		t.Run("when the server returns 400", func(t *testing.T) {
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"bad input"}`))
			}, WithMaxRetries(3))

			_, err := c.Prompts.List(context.Background())
			require.Error(t, err)
			assert.Equal(t, int32(1), atomic.LoadInt32(&calls), "4xx is not retried")
		})
	})

	t.Run("given a retried idempotent request with a body", func(t *testing.T) {
		t.Run("when the first attempt fails", func(t *testing.T) {
			// PUT is idempotent, so it is retried — and its body must be replayed
			// byte-for-byte.
			var calls int32
			var mu sync.Mutex
			var bodies []string
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				// Read the body to completion: io.Reader.Read returns at most
				// len(p) bytes, so a single Read can record a prefix and make two
				// different bodies compare equal.
				raw, readErr := io.ReadAll(r.Body)
				assert.NoError(t, readErr)
				mu.Lock()
				bodies = append(bodies, string(raw))
				mu.Unlock()
				if n == 1 {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				_, _ = w.Write([]byte(`{"id":"prompt_1","handle":"h","scope":"PROJECT","name":"n","version":1,"versionId":"v","model":"m","prompt":"","messages":[],"inputs":[],"outputs":[],"tags":[],"parameters":{},"projectId":"p","organizationId":"o","createdAt":"","updatedAt":""}`))
			},
				WithMaxRetries(2),
				WithRetryWaitMax(5*time.Millisecond),
			)

			_, err := c.Prompts.Update(context.Background(), "h", UpdatePromptParams{CommitMessage: "msg"})
			require.NoError(t, err)
			mu.Lock()
			defer mu.Unlock()
			require.Len(t, bodies, 2)
			assert.Equal(t, bodies[0], bodies[1], "request body is replayed identically on retry")
		})
	})

	t.Run("given a POST without an idempotency key", func(t *testing.T) {
		t.Run("when the first attempt fails with 503", func(t *testing.T) {
			// A server can complete a create and still fail to deliver the
			// response. Replaying it would mint a second prompt version, so an
			// unprotected POST is attempted exactly once.
			var calls int32
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				w.WriteHeader(http.StatusServiceUnavailable)
			},
				WithMaxRetries(3),
				WithRetryWaitMax(5*time.Millisecond),
			)

			_, err := c.Prompts.Create(context.Background(), CreatePromptParams{Handle: "h"})
			require.Error(t, err)
			assert.Equal(t, int32(1), atomic.LoadInt32(&calls),
				"a non-idempotent write is not replayed")
			assert.True(t, hasStatus(err, http.StatusServiceUnavailable))
		})
	})

	t.Run("given a POST carrying an idempotency key", func(t *testing.T) {
		t.Run("when the first attempt fails with 503", func(t *testing.T) {
			// The key lets the server collapse the replay onto the original write,
			// so retrying is safe. Exercised at the transport directly because no
			// generated operation sets the header for us.
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if atomic.AddInt32(&calls, 1) == 1 {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				_, _ = w.Write([]byte(`{}`))
			}))
			defer srv.Close()

			d := &retryingDoer{
				inner:        srv.Client(),
				maxRetries:   2,
				retryWaitMin: time.Millisecond,
				retryWaitMax: 5 * time.Millisecond,
				rand:         rand.New(rand.NewSource(1)),
			}
			req, err := http.NewRequestWithContext(context.Background(),
				http.MethodPost, srv.URL, strings.NewReader(`{"handle":"h"}`))
			require.NoError(t, err)
			req.Header.Set(idempotencyKeyHeader, "key-123")

			resp, err := d.Do(req)
			require.NoError(t, err)
			defer func() { _ = resp.Body.Close() }()

			assert.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Equal(t, int32(2), atomic.LoadInt32(&calls),
				"an idempotency-keyed write is retried")
		})
	})
}

func TestIsRetryableRequest(t *testing.T) {
	t.Run("given an idempotent method", func(t *testing.T) {
		for _, method := range []string{
			http.MethodGet, http.MethodHead, http.MethodOptions,
			http.MethodTrace, http.MethodPut, http.MethodDelete,
		} {
			req, err := http.NewRequest(method, "https://example.test/x", nil)
			require.NoError(t, err)
			assert.True(t, isRetryableRequest(req), method)
		}
	})

	t.Run("given a non-idempotent method without a key", func(t *testing.T) {
		for _, method := range []string{http.MethodPost, http.MethodPatch} {
			req, err := http.NewRequest(method, "https://example.test/x", nil)
			require.NoError(t, err)
			assert.False(t, isRetryableRequest(req), method)
		}
	})

	t.Run("given a non-idempotent method with a key", func(t *testing.T) {
		req, err := http.NewRequest(http.MethodPost, "https://example.test/x", nil)
		require.NoError(t, err)
		req.Header.Set(idempotencyKeyHeader, "key-123")
		assert.True(t, isRetryableRequest(req))
	})
}

func TestDecodeInto(t *testing.T) {
	t.Run("given a 2xx with a JSON body", func(t *testing.T) {
		t.Run("when decoding into a struct", func(t *testing.T) {
			// Exercises the streaming success path: the body is decoded straight
			// off the wire rather than buffered first.
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{"id":"ds_1","slug":"golden","name":"Golden"}`))
			})
			d, err := c.Datasets.Get(context.Background(), "golden")
			require.NoError(t, err)
			assert.Equal(t, "ds_1", d.ID)
		})
	})

	t.Run("given a 2xx with an empty body", func(t *testing.T) {
		t.Run("when decoding into a non-nil out", func(t *testing.T) {
			// A 200 with no payload yields io.EOF from the decoder, which must be
			// treated as "nothing to decode" rather than surfaced as an error.
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			})
			_, err := c.Datasets.Delete(context.Background(), "golden")
			require.NoError(t, err)
		})
	})

	t.Run("given a 2xx with an undecodable body", func(t *testing.T) {
		t.Run("when decoding into a struct", func(t *testing.T) {
			c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(`{not json`))
			})
			_, err := c.Datasets.Get(context.Background(), "golden")
			require.Error(t, err)
			var apiErr *APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, http.StatusOK, apiErr.StatusCode)
		})
	})
}

func TestParseRetryAfter(t *testing.T) {
	t.Run("given a numeric seconds value", func(t *testing.T) {
		assert.Equal(t, 3*time.Second, parseRetryAfter("3"))
	})
	t.Run("given an empty value", func(t *testing.T) {
		assert.Equal(t, time.Duration(0), parseRetryAfter(""))
	})
	t.Run("given a negative value", func(t *testing.T) {
		assert.Equal(t, time.Duration(0), parseRetryAfter("-5"))
	})
	t.Run("given garbage", func(t *testing.T) {
		assert.Equal(t, time.Duration(0), parseRetryAfter("soon"))
	})
}

func TestIsRetryableStatus(t *testing.T) {
	t.Run("retryable statuses", func(t *testing.T) {
		assert.True(t, isRetryableStatus(http.StatusTooManyRequests))
		assert.True(t, isRetryableStatus(http.StatusInternalServerError))
		assert.True(t, isRetryableStatus(http.StatusBadGateway))
	})
	t.Run("non-retryable statuses", func(t *testing.T) {
		assert.False(t, isRetryableStatus(http.StatusOK))
		assert.False(t, isRetryableStatus(http.StatusBadRequest))
		assert.False(t, isRetryableStatus(http.StatusNotFound))
	})
}
