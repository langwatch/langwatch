package pipeline

// A routing policy rewrites the model name before dispatch, and the trace
// records what was dispatched. Without the name the client sent, a trace of a
// tier request says nothing about the tier, and repointing a tier silently
// rewrites the history of what every caller asked for.
//
// The Trace interceptor carries it on the same four exits as VKTags, so the
// same shape of test guards it.

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func tierRequest() *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "complex",
		Resolved: &domain.ResolvedModel{
			ModelID:    "gpt-5.6-sol",
			ProviderID: domain.ProviderOpenAI,
			Source:     domain.ModelSourceAlias,
		},
	}
}

func tracedBundle() *domain.Bundle {
	return &domain.Bundle{
		ProjectID:    "proj_test",
		VirtualKeyID: "vk_test",
		Config:       domain.BundleConfig{TraceProjectID: "proj_test"},
	}
}

// @scenario "A rewritten model name reaches the customer span"
func TestTracePassesRequestedModelToEndParams(t *testing.T) {
	t.Run("when the sync call succeeds", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (*domain.Response, error) {
			return &domain.Response{}, nil
		}

		_, err := interceptor.Sync(next)(context.Background(), &Call{
			Bundle:  tracedBundle(),
			Request: tierRequest(),
			Meta:    &MetaAccumulator{},
		})

		require.NoError(t, err)
		captured.WaitForEnd(t)
		assert.Equal(t, "complex", captured.params.RequestedModel)
		assert.Equal(t, "gpt-5.6-sol", captured.params.Model)
	})

	t.Run("when the sync call fails upstream", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (*domain.Response, error) {
			return nil, &domain.UpstreamError{StatusCode: 504}
		}

		_, err := interceptor.Sync(next)(context.Background(), &Call{
			Bundle:  tracedBundle(),
			Request: tierRequest(),
			Meta:    &MetaAccumulator{},
		})

		require.Error(t, err)
		captured.WaitForEnd(t)
		assert.Equal(t, "complex", captured.params.RequestedModel,
			"a failed tier request is still a tier request")
	})

	t.Run("when the stream never establishes", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (domain.StreamIterator, error) {
			return nil, &domain.UpstreamError{StatusCode: 504}
		}

		_, err := interceptor.Stream(next)(context.Background(), &Call{
			Bundle:  tracedBundle(),
			Request: tierRequest(),
			Meta:    &MetaAccumulator{},
		})

		require.Error(t, err)
		captured.WaitForEnd(t)
		assert.Equal(t, "complex", captured.params.RequestedModel)
	})

	t.Run("when the stream closes", func(t *testing.T) {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (domain.StreamIterator, error) {
			return newChunkedStub([][]byte{[]byte("data: {}\n\n")}), nil
		}

		iter, err := interceptor.Stream(next)(context.Background(), &Call{
			Bundle:  tracedBundle(),
			Request: tierRequest(),
			Meta:    &MetaAccumulator{},
		})

		require.NoError(t, err)
		for iter.Next(context.Background()) {
			_ = iter.Chunk()
		}
		captured.WaitForEnd(t)
		assert.Equal(t, "complex", captured.params.RequestedModel)
	})
}

// @scenario "A model name that was not rewritten stamps nothing"
func TestTraceLeavesRequestedModelEmptyWhenNothingWasRewritten(t *testing.T) {
	// Every spelling of the dispatched model is the caller getting what they
	// asked for, so none is worth recording twice. The provider half has
	// accepted aliases the resolver normalises, and comparing against the
	// canonical form alone read "azure_openai/x" as a rewrite of itself.
	for _, sent := range []string{"gpt-5.6-sol", "openai/gpt-5.6-sol"} {
		captured := newCapturedEnd()
		interceptor := Trace(passThroughBegin, captured.End)
		next := func(context.Context, *Call) (*domain.Response, error) {
			return &domain.Response{}, nil
		}

		request := tierRequest()
		request.Model = sent
		request.Resolved.Source = domain.ModelSourceExplicit

		_, err := interceptor.Sync(next)(context.Background(), &Call{
			Bundle:  tracedBundle(),
			Request: request,
			Meta:    &MetaAccumulator{},
		})

		require.NoError(t, err, sent)
		captured.WaitForEnd(t)
		assert.Empty(t, captured.params.RequestedModel, sent)
	}
}

// @scenario "A provider spelling the gateway normalises is not a rewrite"
func TestTraceTreatsANormalisedProviderSpellingAsNoRewrite(t *testing.T) {
	captured := newCapturedEnd()
	interceptor := Trace(passThroughBegin, captured.End)
	next := func(context.Context, *Call) (*domain.Response, error) {
		return &domain.Response{}, nil
	}

	request := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "azure_openai/gpt-5-mini",
		Resolved: &domain.ResolvedModel{
			ModelID:    "gpt-5-mini",
			ProviderID: domain.ProviderAzure,
			Source:     domain.ModelSourceExplicit,
		},
	}

	_, err := interceptor.Sync(next)(context.Background(), &Call{
		Bundle:  tracedBundle(),
		Request: request,
		Meta:    &MetaAccumulator{},
	})

	require.NoError(t, err)
	captured.WaitForEnd(t)
	assert.Empty(t, captured.params.RequestedModel)
}

// A prefix that is not a provider is part of the model name, so a rewrite to
// a different model still reads as one.
func TestTraceRecordsARewriteAcrossProviders(t *testing.T) {
	captured := newCapturedEnd()
	interceptor := Trace(passThroughBegin, captured.End)
	next := func(context.Context, *Call) (*domain.Response, error) {
		return &domain.Response{}, nil
	}

	request := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "openai/gpt-4o",
		Resolved: &domain.ResolvedModel{
			ModelID:    "gemini-3.5-flash",
			ProviderID: domain.ProviderGemini,
			Source:     domain.ModelSourceAlias,
		},
	}

	_, err := interceptor.Sync(next)(context.Background(), &Call{
		Bundle:  tracedBundle(),
		Request: request,
		Meta:    &MetaAccumulator{},
	})

	require.NoError(t, err)
	captured.WaitForEnd(t)
	assert.Equal(t, "openai/gpt-4o", captured.params.RequestedModel)
}
