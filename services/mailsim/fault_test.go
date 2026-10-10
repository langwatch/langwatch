package mailsim

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestForcedErrorRefusesSendUntilCleared(t *testing.T) {
	s := newTestServer(t, Config{})
	put := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/_sim/api/settings", strings.NewReader(body)))
		return rec
	}

	require.Equal(t, http.StatusOK, put(`{"forcedError":550}`).Code)
	require.Error(t, deliverRaw(t, s, "a@example.com", []string{"b@example.com"}, simpleMessage, nil))
	assert.Empty(t, s.store.List("", ""))

	assert.Equal(t, http.StatusBadRequest, put(`{"forcedError":200}`).Code)
	require.Equal(t, http.StatusOK, put(`{"forcedError":0}`).Code)
	require.NoError(t, deliverRaw(t, s, "a@example.com", []string{"b@example.com"}, simpleMessage, nil))
}
