package pipeline

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestTraceBeginsSyncAndStreamSpansUnderConfigProject(t *testing.T) {
	bundle := &domain.Bundle{
		ProjectID: "project-from-stale-jwt",
		Config: domain.BundleConfig{
			TraceProjectID:   "project-from-fresh-config",
			ProjectOTLPToken: "token-from-fresh-config",
		},
	}
	request := &domain.Request{Type: domain.RequestTypeChat}

	t.Run("sync", func(t *testing.T) {
		var beganFor string
		interceptor := Trace(
			func(ctx context.Context, projectID string, _ domain.RequestType) (context.Context, string) {
				beganFor = projectID
				return ctx, "traceparent"
			},
			func(context.Context, domain.AITraceParams) {},
		)
		next := func(context.Context, *Call) (*domain.Response, error) {
			return &domain.Response{}, nil
		}

		_, err := interceptor.Sync(next)(context.Background(), &Call{
			Bundle:  bundle,
			Request: request,
			Meta:    &Meta{},
		})

		require.NoError(t, err)
		assert.Equal(t, "project-from-fresh-config", beganFor)
	})

	t.Run("stream", func(t *testing.T) {
		var beganFor string
		interceptor := Trace(
			func(ctx context.Context, projectID string, _ domain.RequestType) (context.Context, string) {
				beganFor = projectID
				return ctx, "traceparent"
			},
			func(context.Context, domain.AITraceParams) {},
		)
		next := func(context.Context, *Call) (domain.StreamIterator, error) {
			return newChunkedStub(nil), nil
		}

		_, err := interceptor.Stream(next)(context.Background(), &Call{
			Bundle:  bundle,
			Request: request,
			Meta:    &Meta{},
		})

		require.NoError(t, err)
		assert.Equal(t, "project-from-fresh-config", beganFor)
	})
}

func TestInternalTraceMetadataOnlyUsesConfiguredValues(t *testing.T) {
	model, provider := internalTraceMetadata(domain.BundleConfig{
		ModelAliases: map[string]domain.ModelAlias{
			"safe-alias": {Model: "gpt-5-mini", ProviderID: domain.ProviderOpenAI},
		},
	}, "safe-alias")
	assert.Equal(t, "gpt-5-mini", model)
	assert.Equal(t, domain.ProviderOpenAI, provider)

	model, provider = internalTraceMetadata(domain.BundleConfig{
		AllowedModels: []string{"gpt-5-mini", "claude-*"},
	}, "gpt-5-mini")
	assert.Equal(t, "gpt-5-mini", model)
	assert.Empty(t, provider)

	model, provider = internalTraceMetadata(domain.BundleConfig{
		AllowedModels: []string{"gpt-*"},
	}, "customer-secret-in-model-field")
	assert.Empty(t, model)
	assert.Empty(t, provider)
}
