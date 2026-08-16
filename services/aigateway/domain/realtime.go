package domain

import (
	"errors"

	"github.com/tidwall/gjson"
)

// Realtime voice is brokered, never relayed (ADR-097). The gateway mints the
// vendor's own short-lived session credential and hands it back with a
// LangWatch session id; the media socket runs from the client straight to the
// vendor. One session is one spend record: admitted at the mint, confirmed
// when the vendor reports what the call used.

// RealtimeVendor names the session family a mint belongs to. It is decided by
// the route, not by the model string, because each family has its own mint
// call, its own credential shape and its own usage report.
type RealtimeVendor string

const (
	// RealtimeVendorOpenAI mints an ephemeral client secret for the OpenAI
	// Realtime socket. The caller declares the whole session in the body.
	RealtimeVendorOpenAI RealtimeVendor = "openai"
	// RealtimeVendorElevenLabs mints a signed URL for one hosted
	// Conversational AI agent. The agent lives at the vendor and is
	// addressed by its id.
	RealtimeVendorElevenLabs RealtimeVendor = "elevenlabs"
)

// ElevenLabsConvAIModel is the catalog id a brokered ElevenLabs conversation
// is billed under. The vendor prices a conversation by duration, so there is
// one entry for every agent.
const ElevenLabsConvAIModel = "elevenlabs/convai"

// RealtimeSessionRequest is a session mint. It carries what the vendor call
// needs beyond the body: which family to mint for, and the hosted agent to
// bind the credential to when the family has one.
type RealtimeSessionRequest struct {
	// Vendor is the family this mint belongs to.
	Vendor RealtimeVendor
	// AgentID addresses a hosted agent (ElevenLabs). Empty for OpenAI,
	// whose session is declared in the body instead.
	AgentID string
	// SessionID is the LangWatch id for this session. It is the gateway
	// request id, so the spend record and the session row are the same
	// aggregate seen from two sides.
	SessionID string
}

// RealtimeReservation is a session booking: everything the control plane
// needs to enforce the cap and, later, to find this session again from a
// vendor's post-call report.
type RealtimeReservation struct {
	// SessionID is the gateway request id.
	SessionID      string
	ProjectID      string
	OrganizationID string
	VirtualKeyID   string
	// ModelProviderID is the credential row the mint used. The vendor's
	// webhook is verified against that row's own secret.
	ModelProviderID string
	Vendor          RealtimeVendor
	AgentID         string
	// Model is the catalog id this session bills under.
	Model string
}

// The cap itself is deliberately absent from this struct and from the
// config bundle. It is read inside the control plane's reserve transaction,
// off the key row, next to the count it gates. Carrying it on the bundle
// would put the limit on one clock (the config cache) and the count on
// another, so a key edited a minute ago would still admit against the old
// limit. The gateway has no other use for the number, and this chain already
// carries one field that is materialized, shipped and then dropped at decode
// with nothing reading it.

// RealtimeCorrelation records the vendor's own id for a booked session.
type RealtimeCorrelation struct {
	SessionID            string
	ProjectID            string
	VendorConversationID string
}

// RealtimeRelease closes a booked session that never became a call.
type RealtimeRelease struct {
	SessionID string
	ProjectID string
	// Status is the terminal state to record: FAILED when the mint itself
	// failed, EXPIRED when no call was ever opened with the credential.
	Status string
	Reason string
}

// RealtimeUsageReport closes a session with what its socket measured.
type RealtimeUsageReport struct {
	SessionID string
	ProjectID string
	Usage     Usage
}

// RealtimeMint is what a vendor mint call produced. The gateway returns
// Body to the caller unchanged and keeps the rest for correlation.
type RealtimeMint struct {
	// Body is the vendor's own response, forwarded verbatim so a vendor SDK
	// parses it with no gateway-specific handling.
	Body []byte
	// VendorConversationID is the vendor's id for the conversation this
	// credential opens, when the mint call can report one before the socket
	// exists. It is the exact join key the post-call report arrives under.
	VendorConversationID string
	// ExpiresAtUnix is when the minted credential stops working, when the
	// vendor states it. Zero when it does not.
	ExpiresAtUnix int64
}

// ParseRealtimeUsage reads an OpenAI realtime usage report into the
// gateway's own usage shape, with the audio counts made disjoint from the
// text totals.
//
// The report is what the client read off its socket, so it is accepted in
// both the shapes a client naturally has: the bare usage object, and the
// whole response.done event it arrived in. Nothing else about the event is
// read, and no prompt or transcript content is looked at.
//
// Cached tokens sit inside input_tokens on this wire, and the rest of the
// pipeline prices them separately, so they are taken out here the same way
// the completion lanes take them out.
func ParseRealtimeUsage(body []byte) (Usage, error) {
	root := gjson.ParseBytes(body)
	if !root.IsObject() {
		return Usage{}, errRealtimeUsageShape
	}
	usage := root.Get("usage")
	if !usage.Exists() {
		usage = root.Get("response.usage")
	}
	if !usage.Exists() {
		usage = root
	}
	if !usage.Get("input_tokens").Exists() && !usage.Get("output_tokens").Exists() {
		return Usage{}, errRealtimeUsageShape
	}

	out := Usage{
		PromptTokens:     int(usage.Get("input_tokens").Int()),
		CompletionTokens: int(usage.Get("output_tokens").Int()),
		CacheReadTokens:  int(usage.Get("input_token_details.cached_tokens").Int()),
	}
	out.PromptTokens = max(out.PromptTokens, 0)
	out.CompletionTokens = max(out.CompletionTokens, 0)
	out.CacheReadTokens = max(out.CacheReadTokens, 0)
	if out.CacheReadTokens > out.PromptTokens {
		// A cache count larger than the total it belongs to is not a split
		// this can trust, so none of it is taken out.
		out.CacheReadTokens = 0
	}
	return out.SplitAudioTokens(AudioTokenSplit{
		InputAudio:  int(usage.Get("input_token_details.audio_tokens").Int()),
		InputText:   int(usage.Get("input_token_details.text_tokens").Int()),
		OutputAudio: int(usage.Get("output_token_details.audio_tokens").Int()),
		OutputText:  int(usage.Get("output_token_details.text_tokens").Int()),
	}), nil
}

var errRealtimeUsageShape = errors.New(
	`expected a realtime usage object with input_tokens and output_tokens, ` +
		`either on its own or under "usage"`)

// OpenAIRealtimeSurface is POST /v1/realtime/client_secrets: OpenAI's own
// mint path, served only by an OpenAI credential. The body reaches OpenAI as
// the caller wrote it apart from the resolved model, so no other vendor can
// answer it.
func OpenAIRealtimeSurface() Surface {
	return Surface{
		Name:      "/v1/realtime/client_secrets",
		Providers: []ProviderID{ProviderOpenAI},
	}
}

// ElevenLabsConvAISurface is GET /v1/convai/conversation/get-signed-url:
// ElevenLabs' own mint path, served only by an ElevenLabs credential.
//
// The pin matters more here than on any translated route. A signed URL is
// bound to one agent inside one workspace, so a mint that fell back to
// another vendor, or to another workspace's key, would sign for an agent
// that does not exist there. The endpoint names the vendor; the model string
// never gets a vote.
func ElevenLabsConvAISurface() Surface {
	return Surface{
		Name:      "/v1/convai/conversation/get-signed-url",
		Providers: []ProviderID{ProviderElevenLabs},
	}
}
