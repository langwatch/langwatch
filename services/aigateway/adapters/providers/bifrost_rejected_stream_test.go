package providers

import (
	"bytes"
	"net/http"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func passthroughChunks(bodies ...[]byte) chan *bfschemas.BifrostStreamChunk {
	ch := make(chan *bfschemas.BifrostStreamChunk, len(bodies))
	for _, b := range bodies {
		ch <- &bfschemas.BifrostStreamChunk{BifrostPassthroughResponse: &bfschemas.BifrostPassthroughResponse{StatusCode: http.StatusBadRequest, Body: b}}
	}
	close(ch)
	return ch
}

func asUpstreamError(t *testing.T, err error) *domain.UpstreamError {
	t.Helper()
	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue)
	return ue
}

// @scenario "A rejected stream's error body is reassembled across chunks and bounded"
func TestRejectedPassthroughStream_ReassemblesASplitErrorBody(t *testing.T) {
	first := &bfschemas.BifrostPassthroughResponse{
		StatusCode: http.StatusBadRequest,
		Body:       []byte(`{"type":"error","error":{"type":"invalid_request_error",`),
	}
	rest := passthroughChunks([]byte(`"message":"Your credit balance is too low"}}`))

	ue := asUpstreamError(t, rejectedPassthroughStream(rest, first))

	assert.Equal(t, http.StatusBadRequest, ue.StatusCode)
	assert.JSONEq(t, `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}`, string(ue.Body))
	assert.Equal(t, "Your credit balance is too low", ue.Message)
	assert.Equal(t, "invalid_request_error", ue.ErrorType)
}

// @scenario "A rejected stream's error body is reassembled across chunks and bounded"
func TestRejectedPassthroughStream_CapsTheBodyAndDrainsTheChannel(t *testing.T) {
	first := &bfschemas.BifrostPassthroughResponse{StatusCode: http.StatusBadRequest, Body: bytes.Repeat([]byte("a"), maxPassthroughErrorBodyBytes-10)}
	rest := passthroughChunks(bytes.Repeat([]byte("b"), 100), bytes.Repeat([]byte("c"), 100))

	ue := asUpstreamError(t, rejectedPassthroughStream(rest, first))

	assert.Len(t, ue.Body, maxPassthroughErrorBodyBytes)
	assert.Equal(t, bytes.Repeat([]byte("b"), 10), ue.Body[maxPassthroughErrorBodyBytes-10:])
	assert.NotContains(t, string(ue.Body), "c")
	_, open := <-rest
	assert.False(t, open, "the channel must be drained to its end")
}
