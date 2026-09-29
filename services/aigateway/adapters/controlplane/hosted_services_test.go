package controlplane

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func hostedClient(t *testing.T, handler http.HandlerFunc) (*Client, *bool) {
	t.Helper()
	signed := false
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       func(_ *http.Request, _ []byte) { signed = true },
		HTTPClient: srv.Client(),
	}), &signed
}

func TestCallHostedService_SendsTheIdentityOutsideTheCallersPayload(t *testing.T) {
	var path string
	var envelope map[string]json.RawMessage
	cp, signed := hostedClient(t, func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &envelope)
		_, _ = w.Write([]byte(`{"verdicts":[]}`))
	})

	answer, err := cp.CallHostedService(context.Background(), domain.HostedServiceRequest{
		Operation:      domain.HostedInstantEvalsClassify,
		VirtualKeyID:   "vk_connect",
		OrganizationID: "org_acme",
		ProjectID:      "proj_hidden",
		Body:           []byte(`{"text":"hello","virtual_key_id":"vk_someone_else"}`),
	})

	require.NoError(t, err)
	assert.True(t, *signed, "the call rides the signed channel")
	assert.Equal(t, "/api/internal/gateway/connect/instant-evals-classify", path)
	assert.JSONEq(t, `"vk_connect"`, string(envelope["virtual_key_id"]))
	assert.JSONEq(t, `"org_acme"`, string(envelope["organization_id"]))
	assert.JSONEq(t, `{"text":"hello","virtual_key_id":"vk_someone_else"}`, string(envelope["payload"]),
		"what the caller sent stays inside payload and cannot name another key")
	assert.Equal(t, http.StatusOK, answer.StatusCode)
	assert.JSONEq(t, `{"verdicts":[]}`, string(answer.Body))
}

func TestCallHostedService_RelaysARefusalAsItCame(t *testing.T) {
	const refusal = `{"error":{"type":"connect_service_not_entitled","code":"connect_service_not_entitled","message":"?"}}`
	cp, _ := hostedClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(refusal))
	})

	answer, err := cp.CallHostedService(context.Background(), domain.HostedServiceRequest{Operation: domain.HostedUsage})

	require.NoError(t, err)
	assert.Equal(t, http.StatusForbidden, answer.StatusCode)
	assert.JSONEq(t, refusal, string(answer.Body))
}

func TestCallHostedService_ControlPlaneFailure_IsOurOutageNotTheServicesAnswer(t *testing.T) {
	cp, _ := hostedClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`stack trace`))
	})

	_, err := cp.CallHostedService(context.Background(), domain.HostedServiceRequest{Operation: domain.HostedUsage})

	require.ErrorIs(t, err, domain.ErrHostedServiceUnavailable)
}

func TestCallHostedService_BodyThatIsNotJSON_IsRefusedHere(t *testing.T) {
	called := false
	cp, _ := hostedClient(t, func(http.ResponseWriter, *http.Request) { called = true })

	_, err := cp.CallHostedService(context.Background(), domain.HostedServiceRequest{
		Operation: domain.HostedBudget,
		Body:      []byte(`{"cap":`),
	})

	require.ErrorIs(t, err, domain.ErrBadRequest)
	assert.False(t, called)
}
