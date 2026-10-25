package services_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

type callKey struct{}

// @scenario "A pod runs at most two clusterings at once and tells a third when to retry"
func TestAPodRunsAtMostTwoClusteringsAtOnce(t *testing.T) {
	hold := make(chan struct{})
	entered := make(chan struct{}, 64)
	llm := scriptedLLM(nil)
	var seen sync.Map
	llm.ScriptEmbed(func(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
		// A clustering may embed several batches at once; signal each call only once.
		if _, again := seen.LoadOrStore(ctx.Value(callKey{}), true); !again {
			entered <- struct{}{}
		}
		select {
		case <-hold:
			return embedByText(ctx, req)
		case <-ctx.Done():
			return channels.EmbeddingResponse{}, ctx.Err()
		}
	})
	svc, _ := newService(llm, func(d *services.TopicClusteringDeps) { d.BusyWait = 50 * time.Millisecond })
	var running sync.WaitGroup
	defer running.Wait()
	defer close(hold)
	for call := range 2 {
		ctx := context.WithValue(context.Background(), callKey{}, call)
		running.Go(func() { _, _ = svc.ClusterTopics(ctx, oneTopic()) })
		<-entered
	}

	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
	defer cancel()
	started := time.Now()
	_, err := svc.ClusterTopics(ctx, oneTopic())

	require.ErrorIs(t, err, contract.ErrBusy)
	var handled herr.E
	require.ErrorAs(t, err, &handled)
	assert.Positive(t, handled.Meta["retryAfterMs"])
	assert.GreaterOrEqual(t, time.Since(started), 50*time.Millisecond, "the third call waited for a slot first")
}

// @scenario "A crash inside a clustering answers topic_clustering_failed and the pod keeps serving"
func TestACrashInsideAClusteringAnswersFailed(t *testing.T) {
	cases := map[string]func(*testing.T) channels.LLMChannel{
		"embedding batch": func(*testing.T) channels.LLMChannel {
			llm := scriptedLLM(nil)
			llm.ScriptEmbed(func(context.Context, channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
				panic("embedding batch")
			})
			return llm
		},
		"per-text embedding fallback": func(*testing.T) channels.LLMChannel {
			llm := scriptedLLM(nil)
			llm.ScriptEmbed(func(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
				if len(req.Inputs) == 1 {
					panic("per-text embedding")
				}
				return channels.EmbeddingResponse{}, assert.AnError
			})
			return llm
		},
		"topic naming": func(*testing.T) channels.LLMChannel {
			llm := scriptedLLM(nil)
			llm.ScriptComplete(func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error) {
				panic("naming")
			})
			return llm
		},
	}
	for name, build := range cases {
		t.Run(name, func(t *testing.T) {
			svc, _ := newService(build(t))
			_, err := svc.ClusterTopics(t.Context(), request(contract.ClusteringBatch, traces(twoTopics)))
			require.True(t, herr.IsCode(err, contract.ErrTopicClusteringFailed), "got %v", err)
		})
	}

	svc, _ := newService(scriptedLLM(nil))
	result, err := svc.ClusterTopics(t.Context(), request(contract.ClusteringBatch, traces(twoTopics)))
	require.NoError(t, err, "the pod keeps serving after a crash")
	assert.Len(t, result.Topics, 2)
}
