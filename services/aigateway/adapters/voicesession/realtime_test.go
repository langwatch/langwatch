package voicesession

// The supervisor of a brokered OpenAI Realtime call, and the rules that end
// a call of either family.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func responseDone(id string) string {
	return fmt.Sprintf(`{"type":"response.done","response":{"id":%q,"usage":{`+
		`"total_tokens":253,"input_tokens":132,"output_tokens":121,`+
		`"input_token_details":{"text_tokens":119,"audio_tokens":13,"cached_tokens":64,`+
		`"cached_tokens_details":{"text_tokens":64,"audio_tokens":0}},`+
		`"output_token_details":{"text_tokens":30,"audio_tokens":91}}}}`, id)
}

// @scenario "Each Realtime response is one report"
func TestRealtimeEachResponseIsOneReport(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, `{"type":"session.created","session":{"id":"sess_1"}}`)
	for _, id := range []string{"resp_1", "resp_2", "resp_3"} {
		r.vendor.send(conn, `{"type":"response.output_audio.delta","delta":"QUJD"}`)
		r.vendor.send(conn, responseDone(id))
	}
	reports := r.registry.awaitReports(t, 3)

	for i, id := range []string{"resp_1", "resp_2", "resp_3"} {
		report := reports[i]
		assert.Equal(t, id, report.ReportKey)
		assert.Equal(t, 119, report.Usage.PromptTokens, "text input, with the audio taken out")
		assert.Equal(t, 13, report.Usage.InputAudioTokens)
		assert.Equal(t, 30, report.Usage.CompletionTokens)
		assert.Equal(t, 91, report.Usage.OutputAudioTokens)
		assert.Equal(t, 64, report.Usage.CacheReadTokens)
		assert.Equal(t, domain.RealtimeMeteringGateway, report.Source)
		assert.False(t, report.Final)
	}
	r.vendor.mu.Lock()
	defer r.vendor.mu.Unlock()
	assert.Equal(t, []string{"/v1/realtime?call_id=rtc_456"}, r.vendor.attachPaths)
	assert.Equal(t, "Bearer "+providerKey, r.vendor.attachAuth[0])
}

// @scenario "A Realtime call over budget is hung up"
func TestRealtimeBudgetBreachCallsTheHangupRoute(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.registry.receipt = func(n int, _ domain.RealtimeUsageReport) domain.RealtimeUsageReceipt {
		receipt := domain.RealtimeUsageReceipt{Status: domain.RealtimeReportRecorded}
		if n == 2 {
			receipt.Budget = domain.RealtimeBudgetState{Exceeded: true, Scope: "virtual_key", BudgetID: "budget_1"}
		}
		return receipt
	}
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, responseDone("resp_1"))
	r.registry.awaitReports(t, 1)
	assert.Zero(t, r.vendor.hangupCount())
	r.vendor.send(conn, responseDone("resp_2"))

	assert.Equal(t, "/v1/realtime/calls/rtc_456/hangup", r.vendor.awaitHangup())
	assert.Equal(t, ReasonBudgetExceeded, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	require.Len(t, reports, 3)
	assert.True(t, reports[2].Final)
	assert.Nil(t, reports[2].Usage)
	r.vendor.mu.Lock()
	defer r.vendor.mu.Unlock()
	assert.Equal(t, "Bearer "+providerKey, r.vendor.hangupAuth[0])
}

// @scenario "A vendor that closes the socket closes the session"
func TestRealtimeVendorCloseSendsTheFinalClose(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, responseDone("resp_1"))
	r.registry.awaitReports(t, 1)
	require.NoError(t, conn.Close(websocket.StatusNormalClosure, "call ended"))

	assert.Equal(t, ReasonVendorClosed, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	require.Len(t, reports, 2)
	assert.True(t, reports[1].Final)
	assert.Nil(t, reports[1].Usage, "the close carries no usage: the responses were already reported")
	assert.Empty(t, reports[1].ReportKey)
	assert.Zero(t, r.vendor.hangupCount())
}

// @scenario "Realtime transcription usage is reported in both its forms"
func TestRealtimeTranscriptionUsageBothUnions(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()

	const event = "conversation.item.input_audio_transcription.completed"
	r.vendor.send(conn, `{"type":"`+event+`","item_id":"item_1","transcript":"hello",`+
		`"usage":{"type":"tokens","input_tokens":40,"output_tokens":9,"input_token_details":{"audio_tokens":38,"text_tokens":2}}}`)
	r.vendor.send(conn, `{"type":"`+event+`","item_id":"item_2","transcript":"hi","usage":{"type":"duration","seconds":3.5}}`)
	r.vendor.send(conn, `{"type":"`+event+`","item_id":"item_3","transcript":"no usage here"}`)
	r.vendor.send(conn, responseDone("resp_1"))
	reports := r.registry.awaitReports(t, 3)

	assert.Equal(t, "item_1", reports[0].ReportKey)
	assert.Equal(t, domain.RealtimePricedAsTranscription, reports[0].PricedAs)
	assert.Equal(t, 38, reports[0].Usage.InputAudioTokens)
	assert.Equal(t, 2, reports[0].Usage.PromptTokens)
	assert.Equal(t, 9, reports[0].Usage.CompletionTokens)

	assert.Equal(t, "item_2", reports[1].ReportKey)
	assert.Equal(t, domain.RealtimePricedAsTranscription, reports[1].PricedAs)
	assert.InDelta(t, 3.5, reports[1].Usage.AudioSeconds, 0.001)

	assert.Equal(t, "resp_1", reports[2].ReportKey, "an event with no usage reports nothing")
	assert.Empty(t, reports[2].PricedAs)
}

// @scenario "Realtime reports wait in a queue while the control plane is down"
func TestRealtimeReportsAreQueuedAndSentInOrder(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.registry.failures = 3
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()

	for _, id := range []string{"resp_1", "resp_2", "resp_3"} {
		r.vendor.send(conn, responseDone(id))
	}
	reports := r.registry.awaitReports(t, 3)

	keys := []string{reports[0].ReportKey, reports[1].ReportKey, reports[2].ReportKey}
	assert.Equal(t, []string{"resp_1", "resp_2", "resp_3"}, keys)
	assert.Len(t, r.registry.snapshot(), 3, "a retried report is recorded once")
}

func TestRealtimeQueueOverflowDropsAndCounts(t *testing.T) {
	t.Parallel()
	s := &session{manager: NewManager(Options{Metrics: newFakeMetrics()}), seen: map[string]struct{}{}}
	metrics, _ := s.manager.metrics.(*fakeMetrics)

	for i := 0; i < maxQueuedReports+5; i++ {
		s.enqueue(Observation{ReportKey: fmt.Sprintf("resp_%d", i)})
	}

	assert.Len(t, s.queue, maxQueuedReports)
	assert.Equal(t, 5, metrics.reports["dropped"])
}

// fakeKeys is the control plane's config route as the supervisor reads it.
type fakeKeys struct {
	reads atomic.Int64
	held  func(held *domain.Bundle) (domain.HeldKey, error)
}

func (f *fakeKeys) ReadHeldKey(_ context.Context, held *domain.Bundle, _ string) (domain.HeldKey, error) {
	f.reads.Add(1)
	return f.held(held)
}

// @scenario "A call whose key is revoked is ended"
func TestCallWithARevokedKeyIsEnded(t *testing.T) {
	t.Parallel()
	for name, held := range map[string]func(*domain.Bundle) (domain.HeldKey, error){
		"revoked or disabled": func(b *domain.Bundle) (domain.HeldKey, error) {
			return domain.HeldKey{Bundle: b, Revoked: true}, nil
		},
		"deleted": func(*domain.Bundle) (domain.HeldKey, error) {
			return domain.HeldKey{}, herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			keys := &fakeKeys{held: held}
			r := newRig(t, func(o *Options) { o.Keys = keys })
			r.start(r.realtime())
			r.vendor.awaitAttach()

			assert.Equal(t, "/v1/realtime/calls/rtc_456/hangup", r.vendor.awaitHangup())
			assert.Equal(t, ReasonKeyRevoked, r.metrics.awaitEnded(t))
			reports := r.registry.snapshot()
			require.Len(t, reports, 1)
			assert.True(t, reports[0].Final)
		})
	}
}

func TestCallsOfOneKeyShareOneKeyRead(t *testing.T) {
	t.Parallel()
	keys := &fakeKeys{held: func(b *domain.Bundle) (domain.HeldKey, error) {
		return domain.HeldKey{Bundle: b, ETag: "v1"}, nil
	}}
	r := newRig(t, func(o *Options) {
		o.Keys = keys
		o.Timing.KeyRefresh = time.Hour
		o.Timing.BudgetInterval = 5 * time.Millisecond
	})
	first, second := r.realtime(), r.realtime()
	second.SessionID, second.Bundle = "req_2", first.Bundle
	r.start(first)
	r.start(second)
	r.vendor.awaitAttach()
	r.vendor.awaitAttach()

	time.Sleep(60 * time.Millisecond)

	assert.Zero(t, keys.reads.Load(), "a bundle younger than the refresh interval is not read again")
	assert.Len(t, r.manager.watches, 1)
}

func TestKeyReadFailureKeepsTheCallRunning(t *testing.T) {
	t.Parallel()
	keys := &fakeKeys{held: func(*domain.Bundle) (domain.HeldKey, error) {
		return domain.HeldKey{}, errors.New("control plane unreachable")
	}}
	r := newRig(t, func(o *Options) { o.Keys = keys })
	r.start(r.realtime())
	r.vendor.awaitAttach()

	require.Eventually(t, func() bool { return keys.reads.Load() >= 2 }, 5*time.Second, 5*time.Millisecond)

	assert.Zero(t, r.vendor.hangupCount(), "an outage is not a revocation")
	assert.Equal(t, 1, r.manager.Supervised())
}

// @scenario "A call the gateway's own budget check blocks is ended"
func TestCallBlockedByTheGatewayBudgetCheckIsEnded(t *testing.T) {
	t.Parallel()
	var checks atomic.Int64
	r := newRig(t, func(o *Options) {
		o.Budget = func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
			if checks.Add(1) < 2 {
				return domain.BudgetDecision{Verdict: domain.BudgetAllow}, nil
			}
			return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
		}
	})
	r.start(r.realtime())
	r.vendor.awaitAttach()

	assert.Equal(t, "/v1/realtime/calls/rtc_456/hangup", r.vendor.awaitHangup())
	assert.Equal(t, ReasonBudgetExceeded, r.metrics.awaitEnded(t))
}

func TestCallWhoseProviderBudgetIsSpentIsEnded(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) {
		o.Budget = func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
			return domain.BudgetDecision{
				Verdict:           domain.BudgetAllow,
				ExcludedProviders: []domain.ExcludedProvider{{ProviderKey: "openai_1"}},
			}, nil
		}
	})
	r.start(r.realtime())
	r.vendor.awaitAttach()

	r.vendor.awaitHangup()
	assert.Equal(t, ReasonBudgetExceeded, r.metrics.awaitEnded(t))
}

// @scenario "A session the control plane already closed is ended"
func TestCallTheControlPlaneClosedIsEnded(t *testing.T) {
	t.Parallel()
	for name, configure := range map[string]func(*fakeRegistry){
		"already closed": func(f *fakeRegistry) {
			f.receipt = func(int, domain.RealtimeUsageReport) domain.RealtimeUsageReceipt {
				return domain.RealtimeUsageReceipt{Status: domain.RealtimeReportAlreadyClosed}
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			r := newRig(t, nil)
			configure(r.registry)
			r.start(r.realtime())
			conn := r.vendor.awaitAttach()

			r.vendor.send(conn, responseDone("resp_1"))

			r.vendor.awaitHangup()
			assert.Equal(t, ReasonSessionClosed, r.metrics.awaitEnded(t))
			assert.Len(t, r.registry.snapshot(), 1, "nothing more is sent to a closed session")
		})
	}
}

// @scenario "A call whose server-side socket cannot be re-attached is ended"
func TestRealtimeSidebandThatCannotReattachIsEnded(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) { o.Timing.ReattachWindow = 60 * time.Millisecond })
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()
	r.vendor.send(conn, responseDone("resp_1"))
	r.registry.awaitReports(t, 1)

	r.vendor.mu.Lock()
	r.vendor.refuseAttach = 500
	r.vendor.mu.Unlock()
	require.NoError(t, conn.CloseNow())

	assert.Equal(t, "/v1/realtime/calls/rtc_456/hangup", r.vendor.awaitHangup())
	assert.Equal(t, ReasonSidebandLost, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	require.Len(t, reports, 2)
	assert.True(t, reports[1].Final, "the session closes at what was recorded")
}

func TestRealtimeReattachToACallTheVendorEndedClosesIt(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()

	r.vendor.mu.Lock()
	r.vendor.refuseAttach = 404
	r.vendor.mu.Unlock()
	require.NoError(t, conn.CloseNow())

	assert.Equal(t, ReasonVendorClosed, r.metrics.awaitEnded(t))
	assert.Zero(t, r.vendor.hangupCount())
}

func TestSupervisedGaugeFollowsTheCalls(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.realtime())
	conn := r.vendor.awaitAttach()

	r.metrics.mu.Lock()
	assert.Equal(t, 1, r.metrics.gauges["realtime"])
	r.metrics.mu.Unlock()

	require.NoError(t, conn.Close(websocket.StatusNormalClosure, ""))
	r.metrics.awaitEnded(t)

	r.metrics.mu.Lock()
	defer r.metrics.mu.Unlock()
	assert.Equal(t, 0, r.metrics.gauges["realtime"])
	assert.Equal(t, []string{"realtime:vendor_closed"}, r.metrics.ended)
}
