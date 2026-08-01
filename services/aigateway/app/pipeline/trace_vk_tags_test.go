package pipeline

// The Trace interceptor is the only thing carrying BundleConfig.VKTags across
// to AITraceParams, and it has to do so on four independent exits: sync
// success, sync failure, stream-establish failure, and stream close. The wire
// decode and the span stamping are covered on either side of this hop, so a
// dropped or mistyped assignment here is exactly the kind of regression that
// leaves every other test green while the labels quietly stop reaching traces.
//
// Spec: specs/ai-gateway/span-shape.feature § VK tags land on customer spans as labels

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

var vkTagsFixture = []string{"app=acme-support", "team=platform"}

func bundleWithVKTags() *domain.Bundle {
	return &domain.Bundle{
		ProjectID:    "proj_test",
		VirtualKeyID: "vk_test",
		Config: domain.BundleConfig{
			TraceProjectID: "proj_test",
			VKTags:         vkTagsFixture,
		},
	}
}

func passThroughBegin(ctx context.Context, _ string, _ domain.RequestType) (context.Context, string) {
	return ctx, "traceparent"
}

// @scenario "Virtual-key tags are stamped on the customer span as labels"
func TestTracePassesVKTagsToEndParams(t *testing.T) {
	request := &domain.Request{
		Type:     domain.RequestTypeChat,
		Resolved: &domain.ResolvedModel{ModelID: "gpt-5-mini", ProviderID: domain.ProviderOpenAI},
	}

	t.Run("when the sync call succeeds", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (*domain.Response, error) {
			return &domain.Response{}, nil
		}

		_, err := interceptor.Sync(next)(context.Background(), &Call{
			Bundle:  bundleWithVKTags(),
			Request: request,
			Meta:    &MetaAccumulator{},
		})

		require.NoError(t, err)
		captured.WaitForEnd(t)
		assert.Equal(t, vkTagsFixture, captured.params.VKTags)
	})

	t.Run("when the sync call fails upstream", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (*domain.Response, error) {
			return nil, &domain.UpstreamError{StatusCode: 504}
		}

		_, err := interceptor.Sync(next)(context.Background(), &Call{
			Bundle:  bundleWithVKTags(),
			Request: request,
			Meta:    &MetaAccumulator{},
		})

		require.Error(t, err)
		captured.WaitForEnd(t)
		assert.Equal(t, vkTagsFixture, captured.params.VKTags,
			"a failed request is still the tagged VK's traffic")
	})

	t.Run("when the stream never establishes", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (domain.StreamIterator, error) {
			return nil, &domain.UpstreamError{StatusCode: 504}
		}

		_, err := interceptor.Stream(next)(context.Background(), &Call{
			Bundle:  bundleWithVKTags(),
			Request: request,
			Meta:    &MetaAccumulator{},
		})

		require.Error(t, err)
		captured.WaitForEnd(t)
		assert.Equal(t, vkTagsFixture, captured.params.VKTags)
	})

	t.Run("when the stream closes", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (domain.StreamIterator, error) {
			return newChunkedStub([][]byte{[]byte("data: {}\n\n")}), nil
		}

		iter, err := interceptor.Stream(next)(context.Background(), &Call{
			Bundle:  bundleWithVKTags(),
			Request: request,
			Meta:    &MetaAccumulator{},
		})

		require.NoError(t, err)
		for iter.Next(context.Background()) {
			_ = iter.Chunk()
		}
		captured.WaitForEnd(t)
		assert.Equal(t, vkTagsFixture, captured.params.VKTags)
	})
}

// @scenario "A VK without tags stamps no labels attribute"
func TestTraceLeavesVKTagsEmptyForUntaggedKey(t *testing.T) {
	captured := newCapturedEnd()
	interceptor := Trace(passThroughBegin, captured.End)
	next := func(context.Context, *Call) (*domain.Response, error) {
		return &domain.Response{}, nil
	}

	_, err := interceptor.Sync(next)(context.Background(), &Call{
		Bundle: &domain.Bundle{
			ProjectID: "proj_test",
			Config:    domain.BundleConfig{TraceProjectID: "proj_test"},
		},
		Request: &domain.Request{
			Type:     domain.RequestTypeChat,
			Resolved: &domain.ResolvedModel{ModelID: "gpt-5-mini"},
		},
		Meta: &MetaAccumulator{},
	})

	require.NoError(t, err)
	captured.WaitForEnd(t)
	assert.Empty(t, captured.params.VKTags)
}
