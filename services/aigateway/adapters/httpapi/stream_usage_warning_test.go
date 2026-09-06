package httpapi

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// chunkStreamIter yields the given chunks then stops. Usage and raw framing
// are configurable so tests can drive every writeSSE branch.
type chunkStreamIter struct {
	chunks [][]byte
	usage  domain.Usage
	isRaw  bool
}

func (s *chunkStreamIter) Next(_ context.Context) bool {
	return len(s.chunks) > 0
}

func (s *chunkStreamIter) Chunk() []byte {
	chunk := s.chunks[0]
	s.chunks = s.chunks[1:]
	return chunk
}

func (s *chunkStreamIter) Usage() domain.Usage { return s.usage }
func (s *chunkStreamIter) Err() error          { return nil }
func (s *chunkStreamIter) Close() error        { return nil }
func (s *chunkStreamIter) RawFraming() bool    { return s.isRaw }

// dataLines extracts every SSE data-line payload from the response body.
func dataLines(body []byte) []string {
	var lines []string
	for _, line := range strings.Split(string(body), "\n") {
		if rest, ok := strings.CutPrefix(line, "data: "); ok {
			lines = append(lines, rest)
		}
	}
	return lines
}

// @scenario "provider reported no usage -> diagnostics go out as an SSE comment, not a data frame"
func TestWriteSSE_ZeroUsageNoteRidesSSEComment(t *testing.T) {
	iter := &chunkStreamIter{
		chunks: [][]byte{[]byte(`{"id":"c1","choices":[{"delta":{"content":"hi"}}]}`)},
	}
	rec := httptest.NewRecorder()
	writeSSE(context.Background(), rec, iter)

	body := rec.Body.String()
	assert.Contains(t, body, ": provider_did_not_report_usage_on_stream\n\n",
		"the diagnostic must stay observable as an SSE comment line")
	assert.NotContains(t, body, `"warning"`,
		"a bare warning object crashes strict OpenAI-compatible clients that validate every data payload")

	lines := dataLines(rec.Body.Bytes())
	require.Len(t, lines, 2, "only the forwarded chunk and [DONE] may appear as data frames")
	assert.JSONEq(t, `{"id":"c1","choices":[{"delta":{"content":"hi"}}]}`, lines[0])
	assert.Equal(t, "[DONE]", lines[1])
}

// @scenario "provider reported usage -> no trailing diagnostics frame at all"
func TestWriteSSE_NonZeroUsageNoDiagnostics(t *testing.T) {
	iter := &chunkStreamIter{
		chunks: [][]byte{[]byte(`{"id":"c1","choices":[],"usage":{"total_tokens":8}}`)},
		usage:  domain.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8},
	}
	rec := httptest.NewRecorder()
	writeSSE(context.Background(), rec, iter)

	body := rec.Body.String()
	assert.NotContains(t, body, "provider_did_not_report_usage_on_stream")
	assert.NotContains(t, body, `"warning"`)
}

// @scenario "raw passthrough streams (Gemini) are never appended to"
func TestWriteSSE_RawFramingNeverAppended(t *testing.T) {
	upstream := "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ola\"}]}}]}\n\n"
	iter := &chunkStreamIter{
		chunks: [][]byte{[]byte(upstream)},
		isRaw:  true,
	}
	rec := httptest.NewRecorder()
	writeSSE(context.Background(), rec, iter)

	assert.Equal(t, upstream, rec.Body.String(),
		"raw passthrough must forward upstream bytes verbatim, nothing appended")
}
