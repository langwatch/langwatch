package domain

import (
	"context"
	"strings"
	"time"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
)

// RealtimeBroker names a brokered call. The gateway makes the SDP exchange
// with the vendor, then holds its own server-side socket to the same call to
// meter it and to end it. Media still runs client to vendor.
type RealtimeBroker string

const (
	// RealtimeBrokerLive is POST /v1/live/sessions, priced per second.
	RealtimeBrokerLive RealtimeBroker = "live"
	// RealtimeBrokerCall is POST /v1/realtime/calls, priced by token.
	RealtimeBrokerCall RealtimeBroker = "call"
)

// ErrVoiceBrokerUnavailable means this gateway cannot take another brokered
// call right now: it is draining, or it already supervises as many calls as
// it is configured to hold. Nothing was booked and nothing was created.
var ErrVoiceBrokerUnavailable = herr.Code("voice_broker_unavailable")

// BrokeredVoiceSession is one call the gateway supervises after the setup
// request has answered.
type BrokeredVoiceSession struct {
	// SessionID is the LangWatch session id the usage reports go to.
	SessionID string
	Kind      RealtimeSessionKind
	// VendorSessionID is the vendor's id: live_... or rtc_...
	VendorSessionID string
	// Credential is the provider key the setup call used. The server-side
	// socket and the hangup call authenticate with it.
	Credential Credential
	// Bundle is the key's bundle as resolved for the setup request.
	Bundle *Bundle
	// EndUserID is the end user the setup request was attributed to.
	EndUserID string
	StartedAt time.Time
}

// VoiceSlot is one place among the calls a gateway supervises. It is taken
// before the call is booked and ends in exactly one of its three methods.
type VoiceSlot interface {
	// Start hands the call over for supervision and returns at once.
	Start(session BrokeredVoiceSession)
	// Abandon ends a call the vendor created but the gateway will not hand
	// out, then gives the slot back.
	Abandon(ctx context.Context, session BrokeredVoiceSession)
	// Release gives the slot back when no call was created.
	Release()
}

// HeldKey is a virtual key re-read by id for a holder that keeps its bundle
// outside the request path, such as a supervised call.
type HeldKey struct {
	// Bundle carries the config as last read. It is the bundle passed in
	// when the control plane confirmed it unchanged.
	Bundle *Bundle
	// ETag revalidates the next read.
	ETag string
	// Revoked is set when the key was revoked, disabled, deleted or expired.
	Revoked bool
}

// OpenAILiveSurface is POST /v1/live/sessions, served only by an OpenAI
// credential: the body is OpenAI's own session declaration.
func OpenAILiveSurface() Surface {
	return Surface{Name: "/v1/live/sessions", Providers: []ProviderID{ProviderOpenAI}}
}

// OpenAIRealtimeCallSurface is POST /v1/realtime/calls, served only by an
// OpenAI credential.
func OpenAIRealtimeCallSurface() Surface {
	return Surface{Name: "/v1/realtime/calls", Providers: []ProviderID{ProviderOpenAI}}
}

// LiveDelegatedModel reads the backend model a Live session delegates its
// responses to. Empty when the session delegates to the client.
func LiveDelegatedModel(body []byte) string {
	return strings.TrimSpace(gjson.GetBytes(body, "session.delegation.responses.model").String())
}

// ParseRealtimeSocketEvent reads one OpenAI Realtime server event into the
// usage it reports. It answers false for an event that carries none.
func ParseRealtimeSocketEvent(frame []byte) (RealtimeUsageEntry, bool) {
	event := gjson.ParseBytes(frame)
	switch event.Get("type").String() {
	case realtimeEventResponseDone, realtimeEventTranscription:
	default:
		return RealtimeUsageEntry{}, false
	}
	entry, ok, err := parseRealtimeEvent(event)
	if err != nil || !ok || entry.ReportKey == "" {
		return RealtimeUsageEntry{}, false
	}
	return entry, true
}
