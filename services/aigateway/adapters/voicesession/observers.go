// Package voicesession supervises brokered voice calls: one server-side
// socket per call that carries events only, read for usage and used to end
// the call. Media never reaches this process.
package voicesession

import (
	"fmt"
	"math"
	"time"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The observers below turn one vendor server event into what it means for
// metering. They are pure and hold no socket, so a frame-by-frame relay can
// call them on the frames it forwards.

// Observation is one usage report read off a vendor server event.
type Observation struct {
	// ReportKey names the report so a resend is recorded once.
	ReportKey string
	// PricedAs is domain.RealtimePricedAsTranscription for input transcription.
	PricedAs string
	// Model rates the report under another catalog id. Empty for the session's own.
	Model string
	Usage domain.Usage
}

// Event is what one vendor server event means for a supervised call.
type Event struct {
	// Usage is the report the event carries, when it carries one.
	Usage *Observation
	// Seconds is OpenAI Live's cumulative session duration. Read it only
	// when HasSeconds is set, and never sum two of them.
	Seconds    float64
	HasSeconds bool
	// Closed is set when the vendor says the session is over.
	Closed      bool
	CloseReason string
}

// OpenAI Live server events the supervisor reads. Everything else is dropped.
const (
	liveEventUsage    = "session.usage.updated"
	liveEventClosed   = "session.closed"
	liveEventEnvelope = "response.event"

	liveEventInputAudio  = "session.input_audio.append"
	liveEventOutputAudio = "session.output_audio.delta"

	responsesEventCompleted = "response.completed"
)

// PeekEventType reads the type of a vendor event without building a parsed
// tree. It also works on the first bytes of a frame, which is how a large
// audio frame is recognized before the rest of it is read.
func PeekEventType(frame []byte) string {
	return gjson.GetBytes(frame, "type").String()
}

// IsReflectedAudio reports whether an OpenAI Live event carries the call's
// audio, which the sideband receives as base64 and must never keep.
func IsReflectedAudio(eventType string) bool {
	return eventType == liveEventInputAudio || eventType == liveEventOutputAudio
}

// ObserveRealtimeEvent reads one OpenAI Realtime server event: response.done
// keyed by the response id, or an input transcription keyed by its item id.
func ObserveRealtimeEvent(frame []byte) Event {
	entry, ok := domain.ParseRealtimeSocketEvent(frame)
	if !ok {
		return Event{}
	}
	return Event{Usage: &Observation{
		ReportKey: entry.ReportKey,
		PricedAs:  entry.PricedAs,
		Usage:     entry.Usage,
	}}
}

// ObserveLiveEvent reads one OpenAI Live server event: a cumulative duration
// snapshot, the close, or a delegated Responses completion.
func ObserveLiveEvent(frame []byte) Event {
	root := gjson.ParseBytes(frame)
	switch root.Get("type").String() {
	case liveEventUsage:
		seconds := root.Get("usage.seconds")
		return Event{Seconds: max(seconds.Float(), 0), HasSeconds: seconds.Exists()}
	case liveEventClosed:
		seconds := root.Get("usage.seconds")
		return Event{
			Closed:      true,
			CloseReason: root.Get("reason").String(),
			Seconds:     max(seconds.Float(), 0),
			HasSeconds:  seconds.Exists(),
		}
	case liveEventEnvelope:
		if usage, ok := observeDelegatedResponse(root.Get("event")); ok {
			return Event{Usage: &usage}
		}
	}
	return Event{}
}

// observeDelegatedResponse reads the token usage of a finished backend
// response, rated under the backend model and keyed by the response id.
func observeDelegatedResponse(event gjson.Result) (Observation, bool) {
	if event.Get("type").String() != responsesEventCompleted {
		return Observation{}, false
	}
	response := event.Get("response")
	id, usage := response.Get("id").String(), response.Get("usage")
	if id == "" || !usage.IsObject() {
		return Observation{}, false
	}
	observation := Observation{ReportKey: id, Usage: ResponsesUsage(usage)}
	if model := response.Get("model").String(); model != "" {
		observation.Model = string(domain.ProviderOpenAI) + "/" + model
	}
	return observation, true
}

// ResponsesUsage maps a Responses API usage object the way the Responses
// lane does: input_tokens includes the cached prefix, which is also reported
// on its own.
func ResponsesUsage(usage gjson.Result) domain.Usage {
	in := int(max(usage.Get("input_tokens").Int(), 0))
	out := int(max(usage.Get("output_tokens").Int(), 0))
	return domain.Usage{
		PromptTokens:     in,
		CompletionTokens: out,
		TotalTokens:      in + out,
		CacheReadTokens:  int(max(usage.Get("input_tokens_details.cached_tokens").Int(), 0)),
		ReasoningTokens:  int(max(usage.Get("output_tokens_details.reasoning_tokens").Int(), 0)),
	}
}

// LiveMeter turns OpenAI Live's cumulative duration snapshots into deltas.
// A delta that was sent and not acknowledged is offered again unchanged, so
// a failed report is retried under the same key and counted once.
type LiveMeter struct {
	cumulative float64
	reported   float64
	lastKey    string
	lastSent   time.Time
	inflight   *liveDelta
}

type liveDelta struct {
	upTo        float64
	observation Observation
}

// Observe records the latest cumulative snapshot. A lower one is ignored.
func (m *LiveMeter) Observe(seconds float64) {
	if seconds > m.cumulative {
		m.cumulative = seconds
	}
}

// Seconds is the latest cumulative snapshot.
func (m *LiveMeter) Seconds() float64 { return m.cumulative }

// Pending answers the delta to report now, if any. A new delta is offered
// at most once per minInterval unless force is set.
func (m *LiveMeter) Pending(now time.Time, minInterval time.Duration, force bool) (Observation, bool) {
	if m.inflight != nil {
		return m.inflight.observation, true
	}
	delta := math.Round((m.cumulative-m.reported)*1000) / 1000
	if delta <= 0 {
		return Observation{}, false
	}
	if !force && !m.lastSent.IsZero() && now.Sub(m.lastSent) < minInterval {
		return Observation{}, false
	}
	m.lastSent = now
	m.inflight = &liveDelta{upTo: m.cumulative, observation: Observation{
		ReportKey: liveReportKey(m.cumulative, m.lastKey),
		Usage:     domain.Usage{AudioSeconds: delta},
	}}
	return m.inflight.observation, true
}

// Behind reports whether an offered delta predates the latest snapshot, in
// which case more is left to report once it is recorded.
func (m *LiveMeter) Behind() bool {
	return m.inflight != nil && m.inflight.upTo < m.cumulative
}

// Ack marks the offered delta as recorded.
func (m *LiveMeter) Ack() {
	if m.inflight == nil {
		return
	}
	m.reported = m.inflight.upTo
	m.lastKey = m.inflight.observation.ReportKey
	m.inflight = nil
}

// liveReportKey is u-<cumulative whole seconds>. Two reports inside the
// same second get the milliseconds appended, so the second is not dropped
// as a duplicate of the first.
func liveReportKey(cumulative float64, lastKey string) string {
	whole := int64(math.Floor(cumulative))
	key := fmt.Sprintf("u-%d", whole)
	if key != lastKey {
		return key
	}
	return fmt.Sprintf("u-%d-%03d", whole, int64(math.Round((cumulative-float64(whole))*1000)))
}
