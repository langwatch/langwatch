package httpapi_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/noai/adapters/httpapi"
)

func newRouterWithMaxBody(maxBody int64) http.Handler {
	reg := health.New("test")
	reg.MarkStarted()
	return httpapi.NewRouter(httpapi.RouterDeps{
		Logger:              zap.NewNop(),
		Health:              reg,
		MaxRequestBodyBytes: maxBody,
	})
}

func postChat(r http.Handler, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader([]byte(body)))
	r.ServeHTTP(rec, req)
	return rec
}

func postResponses(r http.Handler, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader([]byte(body)))
	r.ServeHTTP(rec, req)
	return rec
}

func TestDecodeJSONErrorBranches(t *testing.T) {
	r := newTestRouter()
	cases := []struct {
		name string
		body string
	}{
		{"empty body", ``},
		{"malformed json", `{not json`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := postChat(r, c.body)
			assert.Equal(t, http.StatusBadRequest, rec.Code)
		})
	}
}

func TestOversizeBodyRejected(t *testing.T) {
	r := newRouterWithMaxBody(64)
	big := `{"model":"langwatch_noai/echo-text","messages":[{"role":"user","content":"` +
		strings.Repeat("x", 500) + `"}]}`
	rec := postChat(r, big)
	// http.MaxBytesReader trips ReadAll, so decodeJSON returns an error and
	// the handler emits the OpenAI-style 400 envelope.
	assert.Contains(t, []int{http.StatusBadRequest, http.StatusRequestEntityTooLarge}, rec.Code)
	assert.Contains(t, rec.Body.String(), "invalid_request_error")
}

/** @scenario "unknown model is rejected with a 404 model_not_found error" */
func TestUnknownModelReturns404(t *testing.T) {
	r := newTestRouter()

	chat := postChat(r, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}]}`)
	assert.Equal(t, http.StatusNotFound, chat.Code)
	assert.Contains(t, chat.Body.String(), "model_not_found")

	resp := postResponses(r, `{"model":"openai/gpt-4o","input":"x"}`)
	assert.Equal(t, http.StatusNotFound, resp.Code)
	assert.Contains(t, resp.Body.String(), "model_not_found")
}
