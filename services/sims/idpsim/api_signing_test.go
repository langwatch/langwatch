package idpsim

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "The tenant page reads the keys, skew and armed break it signs with"
func TestTenantViewCarriesSigningState(t *testing.T) {
	s := newTestServer(t, 1)
	rotateKey(t, s, ``, http.StatusOK)
	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/config", `{"skewSeconds":-90}`).Code)
	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/tamper", `{"mode":"saml-expired"}`).Code)

	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/api/t/1", nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var view struct{ Signing signingView }
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &view))
	assert.Equal(t, signingView{Keys: []string{"t1-k2", "t1-k1"}, SkewSeconds: -90, Armed: "saml-expired"}, view.Signing)
}
