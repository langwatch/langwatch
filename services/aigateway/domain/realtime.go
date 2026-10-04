package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"

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
	// TokenType names the ElevenLabs single-use token to mint. Empty on the
	// OpenAI mint and on the hosted-agent signed URL.
	TokenType ElevenLabsTokenType
	// SessionID is the LangWatch id for this session. It is the gateway
	// request id, so the spend record and the session row are the same
	// aggregate seen from two sides.
	SessionID string
	// Broker is set when the gateway makes the call setup itself and then
	// meters the call from its own server-side socket. Empty on a mint.
	Broker RealtimeBroker
	// SDP is the caller's WebRTC offer on a brokered Realtime call, which
	// travels beside the session JSON. Nil on every other route.
	SDP []byte
}

// Kind says how the session this mint opens is priced.
func (r RealtimeSessionRequest) Kind() RealtimeSessionKind {
	if r.Broker == RealtimeBrokerLive {
		return RealtimeKindLive
	}
	if r.Vendor == RealtimeVendorOpenAI {
		return RealtimeKindRealtime
	}
	if kind, ok := elevenLabsTokenKinds[r.TokenType]; ok {
		return kind
	}
	return RealtimeKindConvAI
}

// RealtimeSessionKind is the pricing family of a booked session. The control
// plane reads it to rate reports and to estimate a session that never reports.
type RealtimeSessionKind string

const (
	// RealtimeKindRealtime is OpenAI Realtime, priced by token.
	RealtimeKindRealtime RealtimeSessionKind = "realtime"
	// RealtimeKindLive is OpenAI Live, priced per second of open session.
	RealtimeKindLive RealtimeSessionKind = "live"
	// RealtimeKindConvAI is an ElevenLabs hosted agent, priced by the vendor's
	// own post-call report.
	RealtimeKindConvAI RealtimeSessionKind = "convai"
	// RealtimeKindTTSSocket is an ElevenLabs speech socket, priced per character.
	RealtimeKindTTSSocket RealtimeSessionKind = "tts_socket"
	// RealtimeKindSTTSocket is ElevenLabs realtime transcription, priced per
	// second of audio.
	RealtimeKindSTTSocket RealtimeSessionKind = "stt_socket"
	// RealtimeKindSTTBatch is one ElevenLabs batch transcription opened with a
	// single-use token, priced per second of audio.
	RealtimeKindSTTBatch RealtimeSessionKind = "stt_batch"
)

// RealtimeMetering names who measures a session: the client that holds the
// socket, or the gateway when the socket runs through it.
type RealtimeMetering string

// The two parties that can measure a session.
const (
	RealtimeMeteringClient  RealtimeMetering = "client"
	RealtimeMeteringGateway RealtimeMetering = "gateway"
)

// ElevenLabsTokenType is the token_type path segment of ElevenLabs'
// single-use token route.
type ElevenLabsTokenType string

// The token types ElevenLabs mints, one per socket family. ttd_websocket is
// the socket under /v1/text-to-dialogue, absent from the vendor's reference.
const (
	ElevenLabsTokenTTSWebsocket   ElevenLabsTokenType = "tts_websocket"
	ElevenLabsTokenTTDWebsocket   ElevenLabsTokenType = "ttd_websocket"
	ElevenLabsTokenRealtimeScribe ElevenLabsTokenType = "realtime_scribe"
	ElevenLabsTokenBatchScribe    ElevenLabsTokenType = "batch_scribe"
)

// ElevenLabsSingleUseTokenLifetime is how long a single-use token opens a
// socket, as the vendor documents it. The mint answer carries no expiry.
const ElevenLabsSingleUseTokenLifetime = 15 * time.Minute

var elevenLabsTokenKinds = map[ElevenLabsTokenType]RealtimeSessionKind{
	ElevenLabsTokenTTSWebsocket:   RealtimeKindTTSSocket,
	ElevenLabsTokenTTDWebsocket:   RealtimeKindTTSSocket,
	ElevenLabsTokenRealtimeScribe: RealtimeKindSTTSocket,
	ElevenLabsTokenBatchScribe:    RealtimeKindSTTBatch,
}

// The vendor's token route names no model, so each type bills under the
// default of the socket it opens unless the mint names another.
var elevenLabsTokenDefaultModels = map[ElevenLabsTokenType]string{
	ElevenLabsTokenTTSWebsocket:   ElevenLabsDefaultSpeechModel,
	ElevenLabsTokenTTDWebsocket:   "eleven_v3_conversational",
	ElevenLabsTokenRealtimeScribe: "scribe_v2_realtime",
	ElevenLabsTokenBatchScribe:    "scribe_v2",
}

// ParseElevenLabsTokenType reads the token_type path segment.
func ParseElevenLabsTokenType(raw string) (ElevenLabsTokenType, bool) {
	tokenType := ElevenLabsTokenType(raw)
	_, ok := elevenLabsTokenKinds[tokenType]
	return tokenType, ok
}

// DefaultModel is the model a token of this type bills under when the mint
// names none.
func (t ElevenLabsTokenType) DefaultModel() string {
	return elevenLabsTokenDefaultModels[t]
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
	// RequestedModel is the model id the caller asked for, which is what the
	// mint's own span records. It differs from Model whenever the request
	// named a provider-prefixed alias, and the settlement has to use it or one
	// call reads as two models on the trace surface.
	RequestedModel string
	// TraceID is the customer-facing trace this mint was recorded under, so
	// the settlement can write the call's cost back into the same trace.
	// Empty when the request carried no trace context.
	TraceID string
	// Kind is the pricing family, which also picks the estimate a session
	// that never reports settles at.
	Kind RealtimeSessionKind
	// Metering names who reports usage. Empty when the vendor does, as on a
	// hosted agent.
	Metering RealtimeMetering
	// TranscriptionModel is the catalog id that prices input transcription
	// usage, when the session declared one.
	TranscriptionModel string
	// CredentialExpiresAt is when the minted credential stops opening a
	// socket. Zero when it is only known after the mint.
	CredentialExpiresAt time.Time
}

// The cap itself is deliberately absent from this struct and from the
// config bundle. It is read inside the control plane's reserve transaction,
// off the key row, next to the count it gates. Carrying it on the bundle
// would put the limit on one clock (the config cache) and the count on
// another, so a key edited a minute ago would still admit against the old
// limit. The gateway has no other use for the number, and this chain already
// carries one field that is materialized, shipped and then dropped at decode
// with nothing reading it.

// RealtimeCorrelation records what only the mint answer knows about a booked
// session: the vendor's own conversation id, the credential expiry, or both.
type RealtimeCorrelation struct {
	SessionID            string
	ProjectID            string
	VendorConversationID string
	// CredentialExpiresAt is zero when the vendor stated none.
	CredentialExpiresAt time.Time
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

// RealtimeUsageReport is one usage report against a booked session. It is the
// same call for a client posting what its socket reported and for the gateway
// reporting a socket it holds itself.
type RealtimeUsageReport struct {
	SessionID string
	ProjectID string
	// VirtualKeyID is the key the report arrived on. The registry matches on
	// it as well as the project, so one key cannot close a session another
	// key opened: several keys can share a project, and the spend record
	// belongs to the key that was admitted.
	VirtualKeyID string
	// ReportKey names this report, so a resend is recorded once: the vendor's
	// response id, a transcription item id, or a caller's own id. Empty means
	// Usage is the session total, which closes the session.
	ReportKey string
	// PricedAs is RealtimePricedAsTranscription when the report is rated
	// under the session's transcription model. Empty rates it under the
	// session's own model.
	PricedAs string
	// Model rates this one report under another catalog id. It wins over
	// PricedAs. Empty on a client report.
	Model string
	// Usage is what was measured, with InputChars and AudioSeconds carrying
	// the character and duration priced quantities. Nil on a bare close.
	Usage *Usage
	// Final closes the session once the report is recorded.
	Final bool
	// DurationMS is how long the call ran, when the closer knows.
	DurationMS int64
	// Source names who measured the usage.
	Source RealtimeMetering
}

// RealtimePricedAsTranscription rates a report under the session's
// transcription model.
const RealtimePricedAsTranscription = "transcription"

// RealtimeReportStatus is what the control plane did with one report.
type RealtimeReportStatus string

// The first four are the control plane's answers, in its own words.
const (
	RealtimeReportRecorded      RealtimeReportStatus = "recorded"
	RealtimeReportDuplicate     RealtimeReportStatus = "duplicate"
	RealtimeReportClosed        RealtimeReportStatus = "closed"
	RealtimeReportAlreadyClosed RealtimeReportStatus = "already_closed"
	// RealtimeReportNoUsage is the gateway's own answer to a post that
	// carried nothing to record. The control plane is not called.
	RealtimeReportNoUsage RealtimeReportStatus = "no_usage"
)

// RealtimeUsageReceipt is the control plane's answer to one report.
type RealtimeUsageReceipt struct {
	Status RealtimeReportStatus
	// CostNanoUSD is this report as rated. Zero for a duplicate and for a
	// session that was already closed.
	CostNanoUSD int64
	// SessionCostNanoUSD is everything recorded for the session so far.
	SessionCostNanoUSD int64
	Budget             RealtimeBudgetState
}

// RealtimeBudgetState says whether a blocking budget on the key's chain is at
// or past its limit, counting what this session has recorded so far.
type RealtimeBudgetState struct {
	Exceeded bool
	// Scope and BudgetID name the budget, and are set only when Exceeded.
	Scope    string
	BudgetID string
	// Unknown is set when the control plane could not read the budgets.
	Unknown bool
}

// RealtimeUsageEntry is one report read off a client's post, before it is
// bound to a session.
type RealtimeUsageEntry struct {
	ReportKey string
	PricedAs  string
	Usage     Usage
}

// RealtimeUsagePost is a client's usage post, read into the reports it
// carries. No entries with Final set is a bare close.
type RealtimeUsagePost struct {
	Entries    []RealtimeUsageEntry
	Final      bool
	DurationMS int64
}

// MaxRealtimeUsageEvents caps one batch of socket events.
const MaxRealtimeUsageEvents = 100

const (
	realtimeEventResponseDone  = "response.done"
	realtimeEventTranscription = "conversation.item.input_audio_transcription.completed"
)

// ParseRealtimeUsagePost reads what a client posts against its session: one
// socket event, a batch under "events", a usage object, or a bare close.
//
// Only ids and usage counts are read. Transcripts and prompts on a forwarded
// event are never looked at.
func ParseRealtimeUsagePost(body []byte) (RealtimeUsagePost, error) {
	root := gjson.ParseBytes(body)
	if !root.IsObject() {
		return RealtimeUsagePost{}, errRealtimeUsageShape
	}
	entries, err := parseRealtimeUsageEntries(root)
	if err != nil {
		return RealtimeUsagePost{}, err
	}
	return RealtimeUsagePost{
		Entries:    entries,
		Final:      root.Get("final").Bool(),
		DurationMS: max(root.Get("duration_ms").Int(), 0),
	}, nil
}

// parseRealtimeUsageEntries reads the reports one post carries. A body with
// nothing to record is accepted only as a close.
func parseRealtimeUsageEntries(root gjson.Result) ([]RealtimeUsageEntry, error) {
	if events := root.Get("events"); events.Exists() {
		return parseRealtimeEventBatch(events)
	}
	switch root.Get("type").String() {
	case realtimeEventResponseDone, realtimeEventTranscription:
		entry, ok, err := parseRealtimeEvent(root)
		if err != nil || !ok {
			return nil, err
		}
		return []RealtimeUsageEntry{entry}, nil
	}
	usage, found, err := parseRealtimeUsageObject(root)
	if err != nil {
		return nil, err
	}
	if found {
		return []RealtimeUsageEntry{{ReportKey: root.Get("id").String(), Usage: usage}}, nil
	}
	if !root.Get("final").Bool() {
		return nil, errRealtimeUsageShape
	}
	return nil, nil
}

// parseRealtimeEventBatch reads the events of a batch in order. Every event
// must name itself: an unnamed total inside a batch would close the session
// with reports still behind it.
func parseRealtimeEventBatch(events gjson.Result) ([]RealtimeUsageEntry, error) {
	if !events.IsArray() {
		return nil, errors.New(`"events" must be an array of socket events`)
	}
	items := events.Array()
	if len(items) > MaxRealtimeUsageEvents {
		return nil, fmt.Errorf("a batch carries at most %d events, got %d", MaxRealtimeUsageEvents, len(items))
	}
	entries := make([]RealtimeUsageEntry, 0, len(items))
	for i, item := range items {
		entry, ok, err := parseRealtimeEvent(item)
		if err != nil {
			return nil, fmt.Errorf("events[%d]: %w", i, err)
		}
		if !ok {
			continue
		}
		if entry.ReportKey == "" {
			return nil, fmt.Errorf("events[%d]: a response.done event in a batch must carry response.id", i)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// parseRealtimeEvent reads one OpenAI socket event. It answers false for an
// event that carries no usage, which is a report of nothing.
func parseRealtimeEvent(event gjson.Result) (RealtimeUsageEntry, bool, error) {
	switch event.Get("type").String() {
	case realtimeEventResponseDone:
		// A response that ended before the model ran carries no usage.
		if event.Get("response").IsObject() && !event.Get("response.usage").IsObject() {
			return RealtimeUsageEntry{}, false, nil
		}
		usage, err := ParseRealtimeUsage([]byte(event.Raw))
		if err != nil {
			return RealtimeUsageEntry{}, false, err
		}
		return RealtimeUsageEntry{ReportKey: event.Get("response.id").String(), Usage: usage}, true, nil
	case realtimeEventTranscription:
		return parseRealtimeTranscriptionEvent(event)
	default:
		return RealtimeUsageEntry{}, false, fmt.Errorf(
			"unsupported event type %q: send %s or %s",
			event.Get("type").String(), realtimeEventResponseDone, realtimeEventTranscription)
	}
}

// parseRealtimeTranscriptionEvent reads the usage of one input transcription.
// The vendor reports it as tokens or as a duration, depending on the model.
func parseRealtimeTranscriptionEvent(event gjson.Result) (RealtimeUsageEntry, bool, error) {
	usage := event.Get("usage")
	if !usage.IsObject() {
		return RealtimeUsageEntry{}, false, nil
	}
	itemID := event.Get("item_id").String()
	if itemID == "" {
		return RealtimeUsageEntry{}, false, errors.New("a transcription event must carry item_id")
	}
	entry := RealtimeUsageEntry{ReportKey: itemID, PricedAs: RealtimePricedAsTranscription}
	if usage.Get("type").String() == "duration" {
		entry.Usage = Usage{AudioSeconds: max(usage.Get("seconds").Float(), 0)}
		return entry, true, nil
	}
	entry.Usage = Usage{
		PromptTokens:     int(max(usage.Get("input_tokens").Int(), 0)),
		CompletionTokens: int(max(usage.Get("output_tokens").Int(), 0)),
	}.SplitAudioTokens(AudioTokenSplit{
		InputAudio: int(usage.Get("input_token_details.audio_tokens").Int()),
		InputText:  int(usage.Get("input_token_details.text_tokens").Int()),
	})
	return entry, true, nil
}

// parseRealtimeUsageObject reads a usage object posted on its own or under
// "usage": OpenAI token counts, or the character and audio-second counts an
// ElevenLabs socket client keeps itself. It answers false when the body
// carries no usage at all.
func parseRealtimeUsageObject(root gjson.Result) (Usage, bool, error) {
	usage, wrapped := root, false
	for _, path := range []string{"usage", "response.usage"} {
		if found := root.Get(path); found.Exists() {
			usage, wrapped = found, true
			break
		}
	}
	characters, seconds := usage.Get("characters"), usage.Get("audio_seconds")
	if characters.Exists() || seconds.Exists() {
		return Usage{
			InputChars:   int(max(characters.Int(), 0)),
			AudioSeconds: max(seconds.Float(), 0),
		}, true, nil
	}
	if !wrapped && !usage.Get("input_tokens").Exists() && !usage.Get("output_tokens").Exists() {
		return Usage{}, false, nil
	}
	parsed, err := ParseRealtimeUsage([]byte(root.Raw))
	return parsed, err == nil, err
}

// RealtimeTranscriptionModel reads the input transcription model an OpenAI
// session declares, as the catalog id that prices it. Empty when the session
// asks for no transcription.
func RealtimeTranscriptionModel(mintBody []byte) string {
	model := strings.TrimSpace(gjson.GetBytes(mintBody, "session.audio.input.transcription.model").String())
	if model == "" {
		return ""
	}
	prefix := string(ProviderOpenAI) + "/"
	if strings.HasPrefix(model, prefix) {
		return model
	}
	return prefix + model
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
//
// When the vendor splits the cached count by modality, only the cached text
// is reported as cache-read. Cached audio stays in the input audio count and
// bills at the full audio rate, the conservative side, because the spend
// vocabulary has no cached-audio quantity yet (langwatch/langwatch#7048).
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

	cached := usage.Get("input_token_details.cached_tokens").Int()
	if details := usage.Get("input_token_details.cached_tokens_details"); details.IsObject() {
		cached = details.Get("text_tokens").Int()
	}
	out := Usage{
		PromptTokens:     int(usage.Get("input_tokens").Int()),
		CompletionTokens: int(usage.Get("output_tokens").Int()),
		CacheReadTokens:  int(cached),
	}
	out.PromptTokens = max(out.PromptTokens, 0)
	out.CompletionTokens = max(out.CompletionTokens, 0)
	out.CacheReadTokens = max(out.CacheReadTokens, 0)

	out = out.SplitAudioTokens(AudioTokenSplit{
		InputAudio:  int(usage.Get("input_token_details.audio_tokens").Int()),
		InputText:   int(usage.Get("input_token_details.text_tokens").Int()),
		OutputAudio: int(usage.Get("output_token_details.audio_tokens").Int()),
		OutputText:  int(usage.Get("output_token_details.text_tokens").Int()),
	})

	// Clamped after the split: a flat cached_tokens counts cached audio too,
	// so it can exceed the text-only PromptTokens the split leaves. A negative
	// remainder would bill those tokens fresh and again as cache-read, so the
	// count is dropped and the session bills as uncached, the higher figure.
	if out.CacheReadTokens > out.PromptTokens {
		out.CacheReadTokens = 0
	}
	return out, nil
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

// ElevenLabsSingleUseTokenSurface is POST /v1/single-use-token/{token_type}:
// ElevenLabs' own token mint, served only by an ElevenLabs credential. A
// token opens a socket inside one workspace, so no other vendor can answer.
func ElevenLabsSingleUseTokenSurface() Surface {
	return Surface{
		Name:      "/v1/single-use-token/{token_type}",
		Providers: []ProviderID{ProviderElevenLabs},
	}
}
