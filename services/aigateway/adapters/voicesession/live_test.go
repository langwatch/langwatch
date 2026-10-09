package voicesession

// The supervisor of a brokered OpenAI Live session, against a fake vendor
// that accepts the server-side socket.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func liveUsage(seconds string) string {
	return `{"type":"session.usage.updated","event_id":"e","usage":{"seconds":` + seconds + `}}`
}

func liveClosed(seconds string) string {
	return `{"type":"session.closed","reason":"close_requested","usage":{"seconds":` + seconds + `}}`
}

// @scenario "Cumulative Live seconds are reported as deltas"
func TestLiveCumulativeSecondsAreReportedAsDeltas(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.live())
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, liveUsage("12"))
	r.registry.awaitReports(t, 1)
	r.vendor.send(conn, liveUsage("15"))
	reports := r.registry.awaitReports(t, 2)

	assert.Equal(t, "u-12", reports[0].ReportKey)
	assert.InDelta(t, 12.0, reports[0].Usage.AudioSeconds, 0.001)
	assert.Equal(t, "u-15", reports[1].ReportKey)
	assert.InDelta(t, 3.0, reports[1].Usage.AudioSeconds, 0.001,
		"the second snapshot replaces the first: 12 then 15 is 15 seconds, never 27")
	assert.Equal(t, domain.RealtimeMeteringGateway, reports[0].Source)
	assert.Equal(t, "proj_1", reports[0].ProjectID)
	assert.Equal(t, "vk_1", reports[0].VirtualKeyID)
	assert.False(t, reports[1].Final)
}

// @scenario "Live duration reports are throttled"
func TestLiveDurationReportsAreThrottled(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) { o.Timing.UsageInterval = 300 * time.Millisecond })
	r.start(r.live())
	conn := r.vendor.awaitAttach()

	for _, seconds := range []string{"1", "2", "3", "4"} {
		r.vendor.send(conn, liveUsage(seconds))
	}
	reports := r.registry.awaitReports(t, 2)

	require.Len(t, r.registry.snapshot(), 2, "four snapshots inside one interval are two reports")
	assert.Equal(t, "u-1", reports[0].ReportKey)
	assert.Equal(t, "u-4", reports[1].ReportKey)
	assert.InDelta(t, 3.0, reports[1].Usage.AudioSeconds, 0.001)
}

// @scenario "A closed Live session sends its final delta and closes"
func TestLiveClosedSendsTheFinalDelta(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	call := r.live()
	call.StartedAt = time.Now().Add(-50 * time.Millisecond)
	r.start(call)
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, liveUsage("12"))
	r.registry.awaitReports(t, 1)
	r.vendor.send(conn, liveClosed("20.5"))

	assert.Equal(t, ReasonVendorClosed, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	require.Len(t, reports, 2)
	final := reports[1]
	assert.True(t, final.Final)
	assert.Equal(t, "u-20", final.ReportKey)
	assert.InDelta(t, 8.5, final.Usage.AudioSeconds, 0.001)
	assert.Positive(t, final.DurationMS)
	assert.Zero(t, r.vendor.hangupCount(), "a session the vendor closed needs no hangup")
	assert.Zero(t, r.manager.Supervised())
}

// @scenario "A delegated response is reported once under its own model"
func TestLiveDelegatedResponseIsReportedOnceUnderItsModel(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.live())
	conn := r.vendor.awaitAttach()

	completed := `{"type":"response.event","delegation_id":"item_1","event":{"type":"response.completed","response":{` +
		`"id":"resp_9","model":"gpt-5.5","output":[],"usage":{"input_tokens":120,"output_tokens":40,` +
		`"input_tokens_details":{"cached_tokens":80},"output_tokens_details":{"reasoning_tokens":16}}}}}`
	r.vendor.send(conn, `{"type":"response.event","event":{"type":"response.output_text.delta","delta":"hi"}}`)
	r.vendor.send(conn, completed)
	r.vendor.send(conn, completed)
	r.vendor.send(conn, liveClosed("0"))

	r.metrics.awaitEnded(t)
	reports := r.registry.snapshot()
	require.Len(t, reports, 2, "one delegated report and the close")
	delegated := reports[0]
	assert.Equal(t, "resp_9", delegated.ReportKey)
	assert.Equal(t, "openai/gpt-5.5", delegated.Model)
	assert.Equal(t, 120, delegated.Usage.PromptTokens)
	assert.Equal(t, 40, delegated.Usage.CompletionTokens)
	assert.Equal(t, 80, delegated.Usage.CacheReadTokens)
	assert.Equal(t, 16, delegated.Usage.ReasoningTokens)
	assert.True(t, reports[1].Final)
	assert.Nil(t, reports[1].Usage, "a session with no duration left closes bare")
}

// @scenario "Reflected audio is dropped without stopping the meter"
func TestLiveReflectedAudioIsDropped(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.live())
	conn := r.vendor.awaitAttach()

	audio := strings.Repeat("QUJD", 300_000)
	r.vendor.send(conn, `{"type":"session.output_audio.delta","delta":"`+audio+`","start_ms":0}`)
	r.vendor.send(conn, `{"audio":"`+audio+`","type":"session.input_audio.append"}`)
	r.vendor.send(conn, `not json at all`)
	r.vendor.send(conn, liveUsage("7"))

	reports := r.registry.awaitReports(t, 1)
	assert.Equal(t, "u-7", reports[0].ReportKey)
	assert.InDelta(t, 7.0, reports[0].Usage.AudioSeconds, 0.001)
}

// @scenario "A Live call over budget is asked to close"
func TestLiveBudgetExceededReceiptSendsSessionClose(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.registry.receipt = func(n int, _ domain.RealtimeUsageReport) domain.RealtimeUsageReceipt {
		receipt := domain.RealtimeUsageReceipt{Status: domain.RealtimeReportRecorded}
		receipt.Budget.Exceeded = n == 1
		return receipt
	}
	r.start(r.live())
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, liveUsage("30"))
	assert.JSONEq(t, `{"type":"session.close"}`, r.vendor.awaitMessage())
	r.vendor.send(conn, liveClosed("31"))

	assert.Equal(t, ReasonBudgetExceeded, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	require.Len(t, reports, 2)
	assert.True(t, reports[1].Final)
	assert.InDelta(t, 1.0, reports[1].Usage.AudioSeconds, 0.001)
	assert.Zero(t, r.vendor.hangupCount(), "the session closed on its socket, so no hangup follows")
}

func TestLiveUnknownBudgetStateIsNoVerdict(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.registry.receipt = func(int, domain.RealtimeUsageReport) domain.RealtimeUsageReceipt {
		receipt := domain.RealtimeUsageReceipt{Status: domain.RealtimeReportRecorded}
		receipt.Budget.Exceeded, receipt.Budget.Unknown = true, true
		return receipt
	}
	r.start(r.live())
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, liveUsage("30"))
	r.registry.awaitReports(t, 1)
	r.vendor.send(conn, liveUsage("40"))
	r.registry.awaitReports(t, 2)

	assert.Zero(t, r.vendor.hangupCount())
	assert.Equal(t, 1, r.manager.Supervised(), "a budget the control plane could not read ends nothing")
}

// @scenario "A Live close that is not confirmed falls back to the hangup route"
func TestLiveCloseNotConfirmedFallsBackToHangup(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) { o.Timing.CloseWait = 50 * time.Millisecond })
	r.start(r.live())
	r.vendor.awaitAttach()

	r.manager.BeginDrain()
	r.manager.endAll()

	r.vendor.awaitMessage()
	assert.Equal(t, "/v1/live/sessions/live_123/hangup", r.vendor.awaitHangup())
	assert.Equal(t, ReasonDrain, r.metrics.awaitEnded(t))
}

// @scenario "A dropped server-side socket is re-attached"
func TestLiveSidebandDropIsReattached(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.live())
	first := r.vendor.awaitAttach()

	r.vendor.send(first, liveUsage("5"))
	r.registry.awaitReports(t, 1)
	require.NoError(t, first.CloseNow())

	second := r.vendor.awaitAttach()
	r.vendor.send(second, liveUsage("9"))
	reports := r.registry.awaitReports(t, 2)

	assert.InDelta(t, 4.0, reports[1].Usage.AudioSeconds, 0.001, "the meter carries across the re-attach")
	assert.Equal(t, 2, r.vendor.attachCount())
	assert.Zero(t, r.vendor.hangupCount())
}

// @scenario "A Live session that never attaches is ended and charged its creation time"
func TestLiveNeverAttachedIsEndedAndCharged(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) { o.Timing.ReattachWindow = 60 * time.Millisecond })
	r.vendor.refuseAttach = http.StatusInternalServerError
	r.start(r.live())

	assert.Equal(t, ReasonSidebandLost, r.metrics.awaitEnded(t))
	assert.Equal(t, 1, r.vendor.hangupCount(), "an unmetered call must not keep running")
	reports := r.registry.snapshot()
	require.Len(t, reports, 1)
	assert.Equal(t, "u-15", reports[0].ReportKey)
	assert.InDelta(t, 15.0, reports[0].Usage.AudioSeconds, 0.001)
	assert.True(t, reports[0].Final)
	assert.Greater(t, r.vendor.attachCount(), 1, "the attach is retried before the call is given up")
}

// @scenario "A failed usage report is retried and counted once"
func TestLiveFailedReportIsRetriedWithoutDoubleCounting(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.registry.failures = 2
	r.start(r.live())
	conn := r.vendor.awaitAttach()

	r.vendor.send(conn, liveUsage("12"))
	r.vendor.send(conn, liveUsage("15"))
	reports := r.registry.awaitReports(t, 2)

	total := 0.0
	for _, report := range r.registry.snapshot() {
		total += report.Usage.AudioSeconds
	}
	assert.InDelta(t, 15.0, total, 0.001, "what the control plane missed is sent again, and only once")
	assert.NotEqual(t, reports[0].ReportKey, reports[1].ReportKey)
	r.metrics.mu.Lock()
	defer r.metrics.mu.Unlock()
	assert.Equal(t, 2, r.metrics.reports["error"])
}

// @scenario "Draining ends the remaining calls and sends their final reports"
func TestDrainEndsCallsAndSendsFinalReports(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) { o.DrainBudget = 80 * time.Millisecond })
	r.start(r.live())
	conn := r.vendor.awaitAttach()
	r.vendor.send(conn, liveUsage("10"))
	r.registry.awaitReports(t, 1)

	ctx, cancel := context.WithCancel(context.Background())
	require.NoError(t, r.manager.Start(ctx))
	cancel()

	assert.JSONEq(t, `{"type":"session.close"}`, r.vendor.awaitMessage())
	r.vendor.send(conn, liveClosed("11"))

	stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer stopCancel()
	require.NoError(t, r.manager.Stop(stopCtx))

	assert.Equal(t, ReasonDrain, r.metrics.awaitEnded(t))
	reports := r.registry.snapshot()
	require.Len(t, reports, 2)
	assert.True(t, reports[1].Final)
	assert.InDelta(t, 1.0, reports[1].Usage.AudioSeconds, 0.001)
	assert.Zero(t, r.manager.Supervised())
}

func TestDrainingManagerRefusesNewCalls(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.manager.BeginDrain()

	_, err := r.manager.Admit(context.Background(), domain.RealtimeKindLive)

	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrVoiceBrokerUnavailable))
}

func TestManagerAtItsCapRefusesNewCalls(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) { o.MaxSessions = 1 })
	slot, err := r.manager.Admit(context.Background(), domain.RealtimeKindLive)
	require.NoError(t, err)

	_, err = r.manager.Admit(context.Background(), domain.RealtimeKindRealtime)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrVoiceBrokerUnavailable))

	slot.Release()
	_, err = r.manager.Admit(context.Background(), domain.RealtimeKindRealtime)
	assert.NoError(t, err, "a released slot is free again")
}

// @scenario "A quiet Live session is kept from being taken for a lost one"
func TestLiveQuietSessionSendsAKeepAliveReport(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(o *Options) { o.Timing.KeepAlive = 30 * time.Millisecond })
	r.start(r.live())
	r.vendor.awaitAttach()

	reports := r.registry.awaitReports(t, 1)

	assert.True(t, strings.HasPrefix(reports[0].ReportKey, "hb-"))
	assert.Zero(t, reports[0].Usage.AudioSeconds)
	assert.False(t, reports[0].Final)
}

// @scenario "The server-side socket carries the provider key"
func TestSidebandAuthenticatesWithTheProviderKey(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.start(r.live())
	conn := r.vendor.awaitAttach()
	r.manager.BeginDrain()
	r.manager.endAll()
	r.vendor.awaitMessage()
	require.NoError(t, conn.Close(websocket.StatusNormalClosure, ""))
	r.metrics.awaitEnded(t)

	r.vendor.mu.Lock()
	defer r.vendor.mu.Unlock()
	assert.Equal(t, []string{"/v1/live/sessions/live_123/attach"}, r.vendor.attachPaths)
	assert.Equal(t, "Bearer "+providerKey, r.vendor.attachAuth[0])
	for _, auth := range append(r.vendor.attachAuth, r.vendor.hangupAuth...) {
		assert.NotContains(t, auth, virtualKey)
	}
	for _, message := range r.vendor.received {
		assert.NotContains(t, message, "session.start", "an attached socket never starts a session")
	}
}
