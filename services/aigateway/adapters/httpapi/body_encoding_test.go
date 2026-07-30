package httpapi

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func gzipBytes(t *testing.T, in []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	_, err := zw.Write(in)
	require.NoError(t, err)
	require.NoError(t, zw.Close())
	return buf.Bytes()
}

func deflateBytes(t *testing.T, in []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zlib.NewWriter(&buf)
	_, err := zw.Write(in)
	require.NoError(t, err)
	require.NoError(t, zw.Close())
	return buf.Bytes()
}

func brotliBytes(t *testing.T, in []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	bw := brotli.NewWriter(&buf)
	_, err := bw.Write(in)
	require.NoError(t, err)
	require.NoError(t, bw.Close())
	return buf.Bytes()
}

func zstdBytes(t *testing.T, in []byte) []byte {
	t.Helper()
	enc, err := zstd.NewWriter(nil)
	require.NoError(t, err)
	out := enc.EncodeAll(in, nil)
	require.NoError(t, enc.Close())
	return out
}

// dispatchedBody returns the request body the pipeline handed the provider,
// materializing the reader when an earlier stage has not already done so.
func dispatchedBody(t *testing.T, req *domain.Request) []byte {
	t.Helper()
	if req.Body != nil {
		return req.Body
	}
	require.NotNil(t, req.BodyReader)
	body, err := io.ReadAll(req.BodyReader)
	require.NoError(t, err)
	return body
}

func encodingRouter(t *testing.T, capture *domain.Request) http.Handler {
	t.Helper()
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			*capture = *req
			return successResponse(), nil
		},
	}
	return buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)
}

// Spec: specs/ai-gateway/gateway-service.feature
// ("Compressed request bodies are decoded before anything reads them")
//
// codex 0.145 posts /v1/responses with `Content-Encoding: zstd` once the user
// is signed in with an OpenAI account. Reading those bytes as JSON finds no
// top-level `model`, which used to fail the turn with a 400 "missing model
// field" before the request ever reached a provider.
func TestRouter_Responses_ZstdEncodedBody(t *testing.T) {
	var got domain.Request
	router := encodingRouter(t, &got)

	payload := []byte(`{"model":"gpt-5.6-sol","input":[{"role":"user","content":"hi"}],"stream":false}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(zstdBytes(t, payload)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "zstd")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "gpt-5.6-sol", got.Model)
	assert.JSONEq(t, string(payload), string(dispatchedBody(t, &got)))
}

/** @scenario "a compressed body is decoded on every dispatch lane" */
func TestRouter_EncodedBodies_DecodedOnEveryLane(t *testing.T) {
	payload := chatBody()

	encodings := []struct {
		name   string
		header string
		encode func(*testing.T, []byte) []byte
	}{
		{name: "gzip", header: "gzip", encode: gzipBytes},
		{name: "deflate", header: "deflate", encode: deflateBytes},
		{name: "brotli", header: "br", encode: brotliBytes},
		{name: "zstd", header: "zstd", encode: zstdBytes},
	}
	// /v1/chat/completions and /v1/responses read the full body;
	// /v1/embeddings goes through the prefix-peek reader instead, so both
	// body paths are covered.
	paths := []string{"/v1/chat/completions", "/v1/responses", "/v1/embeddings"}

	for _, enc := range encodings {
		for _, path := range paths {
			t.Run(enc.name+" "+path, func(t *testing.T) {
				var got domain.Request
				router := encodingRouter(t, &got)

				req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(enc.encode(t, payload)))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Content-Encoding", enc.header)
				req.Header.Set("Authorization", "Bearer vk-lw-test")
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)

				require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
				assert.Equal(t, "gpt-4", got.Model)
				assert.JSONEq(t, string(payload), string(dispatchedBody(t, &got)))
			})
		}
	}
}

// encodingRouterWithLimit builds the router with an explicit body ceiling so a
// compression bomb stays small enough on the wire to clear the raw cap and only
// trip the decoded one.
func encodingRouterWithLimit(t *testing.T, maxBytes int64) http.Handler {
	t.Helper()
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	reg := health.New("test")
	reg.MarkStarted()
	return NewRouter(RouterDeps{
		App: app.New(
			app.WithAuth(auth),
			app.WithProviders(provider),
			app.WithLogger(zap.NewNop()),
		),
		Logger:              zap.NewNop(),
		Health:              reg,
		MaxRequestBodyBytes: maxBytes,
	})
}

// A body layered gzip-then-zstd unwinds outside-in, the order the header lists.
func TestRouter_ChainedContentEncodings(t *testing.T) {
	var got domain.Request
	router := encodingRouter(t, &got)

	payload := chatBody()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		bytes.NewReader(zstdBytes(t, gzipBytes(t, payload))))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip, zstd")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.JSONEq(t, string(payload), string(dispatchedBody(t, &got)))
}

// The outer layer of a chain can decode while the inner one does not: the zstd
// frame is well formed, what it wraps is not gzip. The chain has to unwind the
// decoder it already built before answering, and the answer names the layer that
// actually failed.
func TestRouter_ChainedContentEncodings_InnerLayerFailureIsBadRequest(t *testing.T) {
	var got domain.Request
	router := encodingRouter(t, &got)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		bytes.NewReader(zstdBytes(t, []byte("this is not a gzip stream"))))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip, zstd")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, string(domain.ErrBadRequest), errResp.Error.Type)
	assert.Contains(t, errResp.Error.Message, "malformed gzip request body")
}

// Close order is inner decoder first, source last, and every closer runs even
// after one fails. The reported error is the first one hit along that order.
func TestCloseAll(t *testing.T) {
	var order []string
	spy := func(name string, err error) io.Closer {
		return closerFunc(func() error {
			order = append(order, name)
			return err
		})
	}
	boom := errors.New("boom")

	err := closeAll([]io.Closer{
		spy("source", errors.New("masked")),
		spy("outer", boom),
		spy("inner", nil),
	})

	assert.Equal(t, boom, err)
	assert.Equal(t, []string{"inner", "outer", "source"}, order)
}

type closerFunc func() error

func (f closerFunc) Close() error { return f() }

func TestRouter_IdentityContentEncodingLeavesBodyAlone(t *testing.T) {
	var got domain.Request
	router := encodingRouter(t, &got)

	payload := chatBody()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "identity")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.JSONEq(t, string(payload), string(dispatchedBody(t, &got)))
}

/** @scenario "a content coding the gateway cannot decode is a bad request" */
func TestRouter_UnsupportedContentEncodingIsRejected(t *testing.T) {
	var got domain.Request
	router := encodingRouter(t, &got)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(chatBody()))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "snappy")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, string(domain.ErrBadRequest), errResp.Error.Type)
	assert.Contains(t, errResp.Error.Message, "unsupported content-encoding: snappy")
}

func TestRouter_MalformedEncodedBodyIsBadRequest(t *testing.T) {
	var got domain.Request
	router := encodingRouter(t, &got)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		bytes.NewReader([]byte("this is not a zstd frame")))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "zstd")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, string(domain.ErrBadRequest), errResp.Error.Type)
}

// A few KiB on the wire can expand past the body ceiling, so the decoded
// stream carries the same limit and answers 413 rather than buffering it all.
/** @scenario "a compression bomb is capped at the same ceiling as a raw body" */
func TestRouter_CompressionBombIsPayloadTooLarge(t *testing.T) {
	router := encodingRouterWithLimit(t, 64*1024)

	bomb := zstdBytes(t, bytes.Repeat([]byte("a"), 4*1024*1024))
	require.Less(t, len(bomb), 64*1024, "the compressed body must fit under the raw ceiling")

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(bomb))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "zstd")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, string(domain.ErrPayloadTooLarge), errResp.Error.Type)
}

// /v1/embeddings takes the prefix-peek lane, where the decode failure lands on
// the peek read rather than on a full-body read. Discarding it there would hand
// the model peek a truncated payload and answer with whatever the peek made of
// it instead of the ceiling that was actually hit.
/** @scenario "a compression bomb on the peek lane is capped too" */
func TestRouter_PeekLane_CompressionBombIsPayloadTooLarge(t *testing.T) {
	const maxBytes = 8 * 1024
	router := encodingRouterWithLimit(t, maxBytes)

	// Bigger than the peek window (32 KiB) so the ceiling is crossed while the
	// peek is still filling, not on a later read.
	bomb := zstdBytes(t, bytes.Repeat([]byte("a"), 1024*1024))
	require.Less(t, len(bomb), maxBytes, "the compressed body must fit under the raw ceiling")

	req := httptest.NewRequest(http.MethodPost, "/v1/embeddings", bytes.NewReader(bomb))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "zstd")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusRequestEntityTooLarge, rec.Code, rec.Body.String())
	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, string(domain.ErrPayloadTooLarge), errResp.Error.Type)
}

// With the ceiling above the peek window, the bomb clears the peek and only
// crosses the limit once the pipeline materializes the rest. That read happens
// past the transport, where an unclassified failure answers 500.
/** @scenario "a compression bomb caught after the peek is still a 413" */
func TestRouter_PeekLane_CompressionBombPastThePeekWindow(t *testing.T) {
	const maxBytes = 64 * 1024
	require.Greater(t, int64(maxBytes), int64(defaultPeekBytes),
		"the ceiling must sit past the peek window for the overflow to land in the pipeline")
	router := encodingRouterWithLimit(t, maxBytes)

	bomb := zstdBytes(t, bytes.Repeat([]byte("a"), 4*1024*1024))
	require.Less(t, len(bomb), maxBytes, "the compressed body must fit under the raw ceiling")

	req := httptest.NewRequest(http.MethodPost, "/v1/embeddings", bytes.NewReader(bomb))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "zstd")
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusRequestEntityTooLarge, rec.Code, rec.Body.String())
	var errResp herr.ErrorResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&errResp))
	assert.Equal(t, string(domain.ErrPayloadTooLarge), errResp.Error.Type)
}

// The passthrough lane forwards the client's headers upstream. Once the
// gateway has decoded the body, a surviving Content-Encoding would describe
// bytes the provider never receives.
/** @scenario "the passthrough lane does not forward a stale Content-Encoding" */
func TestRouter_GeminiPassthrough_DecodesBodyAndDropsEncodingHeader(t *testing.T) {
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			return testBundle(), nil
		},
	}
	var got *domain.Request
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			got = req
			return &domain.Response{
				Body:       []byte(`{"candidates":[]}`),
				StatusCode: 200,
			}, nil
		},
	}
	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithLogger(zap.NewNop()),
	)

	payload := []byte(`{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`)
	req := httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-2.5-flash:generateContent",
		bytes.NewReader(gzipBytes(t, payload)))
	req.Header.Set("X-Goog-Api-Key", "vk-lw-test")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NotNil(t, got, "provider was not dispatched")
	assert.NotContains(t, got.Passthrough.Headers, "Content-Encoding")
	assert.JSONEq(t, string(payload), string(dispatchedBody(t, got)))
}

func TestContentEncodings(t *testing.T) {
	assert.Nil(t, contentEncodings(""))
	assert.Nil(t, contentEncodings("identity"))
	assert.Equal(t, []string{"gzip"}, contentEncodings("GZIP"))
	assert.Equal(t, []string{"gzip", "zstd"}, contentEncodings("gzip, identity , zstd"))
}
