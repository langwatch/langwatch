package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// hostedControlPlane answers every hosted-service call with one canned answer
// and records what it was asked.
type hostedControlPlane struct {
	answer domain.HostedServiceResponse
	calls  []domain.HostedServiceRequest
}

func (h *hostedControlPlane) CallHostedService(_ context.Context, req domain.HostedServiceRequest) (domain.HostedServiceResponse, error) {
	h.calls = append(h.calls, req)
	return h.answer, nil
}

func hostedRouter(controlPlane *hostedControlPlane) http.Handler {
	return buildRouter(
		app.WithAuth(audioAuth()),
		app.WithHostedServices(controlPlane),
		app.WithLogger(zap.NewNop()),
	)
}

func hostedRequest(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+domain.LicenseTokenPrefix+strings.Repeat("a", 64))
	req.Header.Set("X-LangWatch-Instance", "instance-a")
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestHostedServices_EachRouteReachesItsOperation(t *testing.T) {
	cases := []struct {
		method, path, body string
		want               domain.HostedServiceOperation
	}{
		{http.MethodPost, "/v1/instant-evals/classify", `{"text":"hello"}`, domain.HostedInstantEvalsClassify},
		{http.MethodGet, "/v1/usage", ``, domain.HostedUsage},
		{http.MethodPut, "/v1/budget", `{"cap_usd":400}`, domain.HostedBudget},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			controlPlane := &hostedControlPlane{answer: domain.HostedServiceResponse{StatusCode: 200, Body: []byte(`{"ok":true}`)}}
			rec := httptest.NewRecorder()

			hostedRouter(controlPlane).ServeHTTP(rec, hostedRequest(tc.method, tc.path, tc.body))

			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			assert.JSONEq(t, `{"ok":true}`, rec.Body.String())
			require.Len(t, controlPlane.calls, 1)
			assert.Equal(t, tc.want, controlPlane.calls[0].Operation)
			assert.Equal(t, tc.body, string(controlPlane.calls[0].Body))
		})
	}
}

func TestHostedServices_RelayedRefusal_KeepsItsStatusAndIsMarkedAsNamed(t *testing.T) {
	const refusal = `{"error":{"type":"connect_service_not_entitled","code":"connect_service_not_entitled","message":"?"}}`
	controlPlane := &hostedControlPlane{answer: domain.HostedServiceResponse{StatusCode: 403, Body: []byte(refusal)}}
	rec := httptest.NewRecorder()

	hostedRouter(controlPlane).ServeHTTP(rec, hostedRequest(http.MethodPost, "/v1/instant-evals/classify", `{"text":"hello"}`))

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.JSONEq(t, refusal, rec.Body.String())
	assert.Equal(t, "connect_service_not_entitled", rec.Header().Get(herr.HandledErrorHeader))
}

// @scenario "A request that is too large is refused before it is judged"
func TestHostedServices_OversizedText_IsRefusedBeforeItReachesTheJudge(t *testing.T) {
	controlPlane := &hostedControlPlane{answer: domain.HostedServiceResponse{StatusCode: 200, Body: []byte(`{}`)}}
	oversized := `{"text":"` + strings.Repeat("a", maxHostedServiceBodyBytes) + `"}`
	rec := httptest.NewRecorder()

	hostedRouter(controlPlane).ServeHTTP(rec, hostedRequest(http.MethodPost, "/v1/instant-evals/classify", oversized))

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Empty(t, controlPlane.calls, "nothing is judged, so nothing is recorded")
}

func TestHostedServices_NoCredential_IsRefusedLikeAnyOtherRoute(t *testing.T) {
	controlPlane := &hostedControlPlane{}
	rec := httptest.NewRecorder()

	hostedRouter(controlPlane).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/usage", nil))

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Empty(t, controlPlane.calls)
}
