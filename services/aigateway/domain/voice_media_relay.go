package domain

import "github.com/langwatch/langwatch/pkg/herr"

// ErrVoiceRelayLicenseRequired means a Twilio media relay was opened with a
// key that is not a license token. Only a license (or a signed request from
// the control plane) may open one.
var ErrVoiceRelayLicenseRequired = herr.Code("voice_relay_license_required")

// ErrVoiceRelayForbidden refuses a Twilio socket. It is the same answer for
// every reason (unknown, expired, replayed, foreign), so a caller probing for
// relay ids learns nothing from the difference.
var ErrVoiceRelayForbidden = herr.Code("voice_relay_forbidden")

// ErrVoiceRelayUnavailable means this gateway cannot open another media
// relay right now: it is draining, full, or the scope holds its maximum of
// relays still waiting for Twilio. Nothing was opened.
var ErrVoiceRelayUnavailable = herr.Code("voice_relay_unavailable")
