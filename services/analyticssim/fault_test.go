package analyticssim

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
)

func TestForcedErrorFailsCapturesUntilCleared(t *testing.T) {
	s := newServer(Config{}, fstest.MapFS{"index.html": {Data: []byte("x")}})
	call := func(method, path, body string) int {
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
		return rec.Code
	}
	capture := `{"api_key":"k","batch":[{"event":"e","distinct_id":"d"}]}`

	assert.Equal(t, http.StatusOK, call(http.MethodPut, "/_sim/api/settings", `{"forcedError":502}`))
	assert.Equal(t, http.StatusBadGateway, call(http.MethodPost, "/batch/", capture))
	assert.Equal(t, http.StatusBadRequest, call(http.MethodPut, "/_sim/api/settings", `{"forcedError":200}`))
	assert.Equal(t, http.StatusOK, call(http.MethodPut, "/_sim/api/settings", `{"forcedError":0}`))
	assert.Equal(t, http.StatusOK, call(http.MethodPost, "/batch/", capture))
}
