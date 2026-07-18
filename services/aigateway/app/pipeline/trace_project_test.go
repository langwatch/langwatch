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
