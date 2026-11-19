package dispatcheradapter

import (
	"context"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// The workflow's private endpoint bindings (ADR-203) reach the dispatcher on
// the credential. Proven without a network: a bound hostname on plain http is
// refused by the binding rule, which only fires when the binding arrived.
func TestDispatchCarriesPrivateEndpointsFromContext(t *testing.T) {
	disp, err := dispatcher.New(context.Background(), dispatcher.Options{
		Logger:                        zap.NewNop(),
		BlockLocalHTTPCalls:           true,
		RequireHTTPSCustomerEndpoints: false,
	})
	require.NoError(t, err)
	t.Cleanup(disp.Close)
	adapter := New(disp)

	req := app.GatewayRequest{
		Model: "custom/acme-model",
		Body:  []byte(`{"model":"acme-model","messages":[{"role":"user","content":"hi"}]}`),
		Headers: map[string]string{headerInlineCredentials: encodeCreds(t, inlineCreds{
			Provider: "custom",
			Custom:   map[string]string{"api_key": "k", "api_base": "http://llm.internal.acme.test/v1"},
		})},
	}
	binding := domain.PrivateEndpoint{
		Hostname:  "llm.internal.acme.test",
		Addresses: []netip.Addr{netip.MustParseAddr("10.20.1.21")},
		Port:      443,
	}

	t.Run("with the bindings on ctx", func(t *testing.T) {
		ctx := domain.WithPrivateEndpoints(context.Background(), []domain.PrivateEndpoint{binding})
		_, err := adapter.ChatCompletions(ctx, req)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "bound to a private endpoint and must use https")
		assert.NotContains(t, err.Error(), "10.20.1.21")

		_, err = adapter.ChatCompletionsStream(ctx, req)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "bound to a private endpoint and must use https")
	})

	t.Run("without bindings the host follows today's rules", func(t *testing.T) {
		_, err := adapter.ChatCompletions(context.Background(), req)
		require.Error(t, err)
		assert.NotContains(t, err.Error(), "private endpoint")
	})
}
