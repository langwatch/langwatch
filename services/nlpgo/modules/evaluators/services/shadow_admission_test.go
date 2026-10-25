package services_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// heldHarness answers every judge call at once, except inputs starting with
// "hold", which wait for the returned release.
func heldHarness(t *testing.T, cfg contract.Config) (harness, func()) {
	t.Helper()
	h := newHarness(t, cfg, 1)
	hold := make(chan struct{})
	h.llm.ScriptComplete(func(ctx context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
		if content, _ := req.Messages[0].Content.(string); strings.HasPrefix(content, "hold") {
			<-hold
		}
		return answer(0.001)(ctx, req)
	})
	return h, sync.OnceFunc(func() { close(hold) })
}

func shadowRequest(t contract.Tenant, input string) contract.EvaluateRequest {
	req := judgeRequest(t, input)
	req.Shadow = true
	return req
}

// startHeld runs n held evaluations in the background and waits until each
// has reached the model.
func startHeld(t *testing.T, h harness, n int, req contract.EvaluateRequest) *sync.WaitGroup {
	t.Helper()
	before := len(h.llm.Completions())
	var running sync.WaitGroup
	for range n {
		running.Go(func() { _, _ = h.service.Evaluate(context.Background(), req) })
	}
	require.Eventually(t, func() bool { return len(h.llm.Completions()) == before+n }, 5*time.Second, 10*time.Millisecond)
	return &running
}

// @scenario "A shadow call is refused at once when the shadow budget is full"
func TestAShadowCallIsRefusedAtOnceWhenTheShadowBudgetIsFull(t *testing.T) {
	cfg := testConfig()
	cfg.ShadowMaxInFlight = 2
	cfg.BusyWaitSeconds = 30
	h, release := heldHarness(t, cfg)
	running := startHeld(t, h, cfg.ShadowMaxInFlight, shadowRequest(tenant("acme"), "hold"))
	defer running.Wait()
	defer release()

	started := time.Now()
	_, err := h.service.Evaluate(t.Context(), shadowRequest(tenant("globex"), "hi"))

	require.ErrorIs(t, err, contract.ErrBusy)
	var handled herr.E
	require.ErrorAs(t, err, &handled)
	assert.Positive(t, handled.Meta["retryAfterMs"])
	assert.Less(t, time.Since(started), time.Second, "a shadow call never waits for a slot")

	results, err := h.service.Evaluate(t.Context(), judgeRequest(tenant("acme"), "hi"))
	require.NoError(t, err)
	assert.Equal(t, contract.StatusProcessed, results[0].Status)
	assert.Less(t, time.Since(started), time.Second, "live calls do not wait behind shadow ones")
}

// @scenario "Shadow calls never take a project's live share"
func TestShadowCallsNeverTakeAProjectsLiveShare(t *testing.T) {
	cfg := testConfig()
	cfg.MaxInFlightPerProject = 1
	cfg.ShadowMaxInFlight = 3
	cfg.BusyWaitSeconds = 30
	h, release := heldHarness(t, cfg)
	shadows := startHeld(t, h, 2, shadowRequest(tenant("acme"), "hold"))
	defer shadows.Wait()
	started := time.Now()
	live := startHeld(t, h, cfg.MaxInFlightPerProject, judgeRequest(tenant("acme"), "hold"))
	defer live.Wait()
	defer release()
	assert.Less(t, time.Since(started), time.Second, "acme's live share was still free")

	results, err := h.service.Evaluate(t.Context(), shadowRequest(tenant("acme"), "hi"))

	require.NoError(t, err, "a full live share does not refuse a shadow call")
	assert.Equal(t, contract.StatusProcessed, results[0].Status)
	assert.Less(t, time.Since(started), time.Second)
}
