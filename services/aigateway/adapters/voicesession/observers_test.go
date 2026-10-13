package voicesession

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPeekEventTypeReadsATruncatedFrame(t *testing.T) {
	t.Parallel()
	head := []byte(`{"type":"session.output_audio.delta","event_id":"e1","delta":"QUJDQUJDQUJD`)

	assert.Equal(t, "session.output_audio.delta", PeekEventType(head))
	assert.True(t, IsReflectedAudio(PeekEventType(head)))
	assert.False(t, IsReflectedAudio("session.usage.updated"))
	assert.Empty(t, PeekEventType([]byte(`{"delta":"QUJD`)), "a head that has not reached the type says nothing")
}

func TestObserveLiveEvent(t *testing.T) {
	t.Parallel()

	usage := ObserveLiveEvent([]byte(`{"type":"session.usage.updated","usage":{"seconds":12.25}}`))
	assert.True(t, usage.HasSeconds)
	assert.InDelta(t, 12.25, usage.Seconds, 0.0001)
	assert.False(t, usage.Closed)

	closed := ObserveLiveEvent([]byte(`{"type":"session.closed","reason":"expired","usage":{"seconds":40}}`))
	assert.True(t, closed.Closed)
	assert.Equal(t, "expired", closed.CloseReason)
	assert.InDelta(t, 40.0, closed.Seconds, 0.0001)

	bare := ObserveLiveEvent([]byte(`{"type":"session.closed","reason":"connection_lost"}`))
	assert.True(t, bare.Closed)
	assert.False(t, bare.HasSeconds)

	for _, frame := range []string{
		`{"type":"session.started","session":{"id":"live_1"}}`,
		`{"type":"response.event","event":{"type":"response.created","response":{"id":"resp_1"}}}`,
		`{"type":"response.event","event":{"type":"response.completed","response":{"id":"resp_1"}}}`,
		`{"type":"response.event","event":{"type":"response.completed","response":{"usage":{"input_tokens":1}}}}`,
		`garbage`,
	} {
		event := ObserveLiveEvent([]byte(frame))
		assert.Nil(t, event.Usage, frame)
		assert.False(t, event.HasSeconds || event.Closed, frame)
	}
}

func TestObserveRealtimeEventIgnoresEverythingWithoutUsage(t *testing.T) {
	t.Parallel()
	for _, frame := range []string{
		`{"type":"session.created"}`,
		`{"type":"response.done","response":{"id":"resp_1","status":"failed"}}`,
		`{"type":"response.done","response":{"usage":{"input_tokens":1,"output_tokens":1}}}`,
		`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item_1"}`,
		`[]`,
	} {
		assert.Nil(t, ObserveRealtimeEvent([]byte(frame)).Usage, frame)
	}
}

func TestLiveMeterNeverSumsSnapshots(t *testing.T) {
	t.Parallel()
	var meter LiveMeter
	now := time.Now()

	meter.Observe(12)
	first, ok := meter.Pending(now, 10*time.Second, false)
	require.True(t, ok)
	assert.Equal(t, "u-12", first.ReportKey)
	assert.InDelta(t, 12.0, first.Usage.AudioSeconds, 0.0001)

	// Not acknowledged: the same delta under the same key, whatever arrived since.
	meter.Observe(15)
	again, ok := meter.Pending(now.Add(time.Minute), 10*time.Second, false)
	require.True(t, ok)
	assert.Equal(t, first, again)
	assert.True(t, meter.Behind())
	meter.Ack()

	_, ok = meter.Pending(now.Add(5*time.Second), 10*time.Second, false)
	assert.False(t, ok, "inside the interval nothing new is offered")

	second, ok := meter.Pending(now.Add(11*time.Second), 10*time.Second, false)
	require.True(t, ok)
	assert.Equal(t, "u-15", second.ReportKey)
	assert.InDelta(t, 3.0, second.Usage.AudioSeconds, 0.0001)
	meter.Ack()

	meter.Observe(9)
	_, ok = meter.Pending(now.Add(time.Hour), 10*time.Second, true)
	assert.False(t, ok, "a lower snapshot is ignored and nothing is owed")
}

func TestLiveMeterKeysTwoReportsInsideOneSecondApart(t *testing.T) {
	t.Parallel()
	var meter LiveMeter
	now := time.Now()

	meter.Observe(12)
	_, _ = meter.Pending(now, 0, true)
	meter.Ack()
	meter.Observe(12.4)
	rest, ok := meter.Pending(now, 0, true)

	require.True(t, ok)
	assert.Equal(t, "u-12-400", rest.ReportKey)
	assert.InDelta(t, 0.4, rest.Usage.AudioSeconds, 0.0001)
}
