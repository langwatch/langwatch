package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/bytedance/sonic"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/voicesession"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Relayed voice sockets (ADR-097). A client on the WebSocket transport
// upgrades here with its virtual key; the gateway dials the vendor with the
// provider key and relays frames both ways, metering from what passes.

const (
	// socketKeySubprotocol is how a browser presents a key on OpenAI Realtime.
	socketKeySubprotocol = "openai-insecure-api-key."
	// realtimeSubprotocol is the one OpenAI subprotocol answered and passed on.
	realtimeSubprotocol = "realtime"
	// liveStartTimeout is how long a Live client has to send session.start.
	liveStartTimeout = 15 * time.Second
	// elevenLabsDialogSocketPath is the vendor's own path, under /v1.
	elevenLabsDialogSocketPath = "/text-to-dialogue/stream-input" //nolint:misspell // ElevenLabs spells its path this way.
	// socketTryAgainLater closes a socket the gateway could not take right now.
	socketTryAgainLater = websocket.StatusCode(1013)
)

// mountVoiceRelayRoutes registers the socket routes, each on the vendor's
// own path so a vendor SDK reaches it by base URL alone.
func mountVoiceRelayRoutes(v1 chi.Router, deps RouterDeps) {
	v1.Get("/live/sessions", openAILiveSocketHandler(deps))
	v1.Get("/realtime", openAIRealtimeSocketHandler(deps))
	speech, dialog := elevenLabsSpeechSocket(), elevenLabsDialogSocket()
	v1.Get("/text-to-speech/{voice_id}/stream-input", elevenLabsSocketHandler(deps, speech))
	v1.Get("/text-to-speech/{voice_id}/multi-stream-input", elevenLabsSocketHandler(deps, speech))
	v1.Get(elevenLabsDialogSocketPath, elevenLabsSocketHandler(deps, dialog))
	v1.Get("/speech-to-text/realtime", elevenLabsSocketHandler(deps, elevenLabsTranscriptionSocket()))
}

// isSocketUpgrade reports whether a request asks for a WebSocket.
func isSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

// socketToken reads a virtual key from where a socket client can put one
// when it cannot set a header: the OpenAI key subprotocol, or the query
// parameters ElevenLabs takes. It answers nothing on a plain request.
func socketToken(r *http.Request) string {
	if !isSocketUpgrade(r) {
		return ""
	}
	for _, protocol := range offeredSubprotocols(r) {
		if key, ok := strings.CutPrefix(protocol, socketKeySubprotocol); ok && key != "" {
			return key
		}
	}
	query := r.URL.Query()
	if key := strings.TrimSpace(query.Get("xi-api-key")); key != "" {
		return key
	}
	key := strings.TrimSpace(query.Get("authorization"))
	if len(key) > 7 && strings.EqualFold(key[:7], "Bearer ") {
		key = strings.TrimSpace(key[7:])
	}
	return key
}

func offeredSubprotocols(r *http.Request) []string {
	var offered []string
	for _, header := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, protocol := range strings.Split(header, ",") {
			if protocol = strings.TrimSpace(protocol); protocol != "" {
				offered = append(offered, protocol)
			}
		}
	}
	return offered
}

// voiceSocket is one upgrade request being answered.
type voiceSocket struct {
	deps RouterDeps
	w    http.ResponseWriter
	r    *http.Request
}

// begin answers the bundle of an upgrade request this gateway can take, and
// refuses everything else over HTTP.
func (s voiceSocket) begin() (*domain.Bundle, bool) {
	bundle, ok := requireBundle(s.w, s.r, s.deps.Logger)
	if !ok {
		return nil, false
	}
	if !isSocketUpgrade(s.r) {
		s.refuse(herr.New(s.r.Context(), domain.ErrBadRequest, herr.M{
			"message": "this route is a WebSocket: send an upgrade request",
			"fault":   "customer",
		}))
		return nil, false
	}
	if err := s.deps.VoiceRelay.Available(s.r.Context()); err != nil {
		s.refuse(err)
		return nil, false
	}
	return bundle, true
}

// refuse answers an upgrade request that was not upgraded.
func (s voiceSocket) refuse(err error) {
	if herr.IsCode(err, domain.ErrVoiceBrokerUnavailable) {
		s.w.Header().Set("Retry-After", strconv.Itoa(voiceBrokerRetryAfter))
	}
	writeError(s.deps.Logger, s.w, s.r.Context(), err)
}

// book runs the request through the pipeline and answers the booked relay.
func (s voiceSocket) book(bundle *domain.Bundle, dispatch app.RealtimeMintDispatch) (*domain.VoiceRelayTicket, error) {
	dispatch.Session.Broker = domain.RealtimeBrokerRelay
	result, err := s.deps.App.HandleRealtimeSession(s.r.Context(), bundle, dispatch)
	if err != nil {
		return nil, err
	}
	if result.Response == nil || result.Response.VoiceRelay == nil {
		return nil, herr.New(s.r.Context(), domain.ErrInternal, herr.M{
			"message": "the relayed socket was not booked", "fault": "gateway",
		})
	}
	setMetaHeaders(s.w, result.Meta)
	return result.Response.VoiceRelay, nil
}

// relay upgrades and relays a booked socket, or refuses it over HTTP.
func (s voiceSocket) relay(call voicesession.RelayCall) {
	if err := s.deps.VoiceRelay.Relay(s.w, s.r, call); err != nil {
		s.refuse(err)
	}
}

// closeSocket tells an upgraded client why its socket ends: the error as a
// frame, then a close whose code says whether to try again.
func (s voiceSocket) closeSocket(client *websocket.Conn, err error) {
	logWriteError(s.deps.Logger, s.r.Context(), err)
	body := herr.Body(err)
	var upstream *domain.UpstreamError
	if errors.As(err, &upstream) {
		body = herr.ErrorBody{Type: string(domain.ErrProviderError), Code: string(domain.ErrProviderError),
			Message: "the provider refused the session"}
	}
	frame, marshalErr := sonic.Marshal(map[string]any{"type": "error", "error": body})
	if marshalErr == nil {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(s.r.Context()), 5*time.Second)
		_ = client.Write(ctx, websocket.MessageText, frame)
		cancel()
	}
	code := websocket.StatusPolicyViolation
	switch status := herr.HTTPStatus(err); {
	case status == http.StatusServiceUnavailable || status == http.StatusTooManyRequests:
		code = socketTryAgainLater
	case status >= http.StatusInternalServerError:
		code = websocket.StatusInternalError
	}
	_ = client.Close(code, body.Code)
}

func bearerHeader(cred domain.Credential) http.Header {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+cred.APIKey)
	return header
}

// openAILiveSocketHandler terminates GET /v1/live/sessions with an upgrade.
// The vendor takes the model in the client's first frame, so that one frame
// is read here, checked and sent on with the resolved model.
func openAILiveSocketHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		socket := voiceSocket{deps: deps, w: w, r: r}
		bundle, ok := socket.begin()
		if !ok {
			return
		}
		// The key authenticates the socket, so any origin may open one.
		client, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		client.SetReadLimit(maxRealtimeMintBodyBytes)
		start, err := readLiveStart(r.Context(), client)
		if err != nil {
			socket.closeSocket(client, err)
			return
		}
		ticket, err := socket.book(bundle, app.RealtimeMintDispatch{
			Body:    start,
			Model:   gjson.GetBytes(start, "session.model").String(),
			Session: domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorOpenAI, RelayKind: domain.RealtimeKindLive},
			Surface: domain.OpenAILiveSurface(),
		})
		if err != nil {
			socket.closeSocket(client, err)
			return
		}
		err = deps.VoiceRelay.Relay(w, r, voicesession.RelayCall{
			Ticket:  ticket,
			Path:    "/v1/live/sessions",
			Header:  bearerHeader(ticket.Session.Credential),
			Client:  client,
			Opening: ticket.Body,
		})
		if err != nil {
			socket.closeSocket(client, err)
		}
	}
}

// readLiveStart reads the one client frame the Live route parses.
func readLiveStart(ctx context.Context, client *websocket.Conn) ([]byte, error) {
	refuse := func(message string) error {
		return herr.New(ctx, domain.ErrBadRequest, herr.M{"message": message, "fault": "customer"})
	}
	readCtx, cancel := context.WithTimeout(ctx, liveStartTimeout)
	defer cancel()
	kind, frame, err := client.Read(readCtx)
	if err != nil {
		return nil, refuse("the first frame must be session.start and did not arrive")
	}
	root := gjson.ParseBytes(frame)
	switch {
	case kind != websocket.MessageText || !root.IsObject() || root.Get("type").String() != "session.start":
		return nil, refuse(`the first frame must be {"type":"session.start","session":{...}}`)
	case root.Get("session.model").String() == "":
		return nil, refuse("session.model is required in session.start")
	}
	return frame, nil
}

// openAIRealtimeSocketHandler terminates GET /v1/realtime?model= with an
// upgrade. The key subprotocol a browser sends is never passed upstream.
func openAIRealtimeSocketHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		socket := voiceSocket{deps: deps, w: w, r: r}
		bundle, ok := socket.begin()
		if !ok {
			return
		}
		model, body, err := realtimeSocketSession(r)
		if err != nil {
			socket.refuse(err)
			return
		}
		ticket, err := socket.book(bundle, app.RealtimeMintDispatch{
			Body:    body,
			Model:   model,
			Session: domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorOpenAI, RelayKind: domain.RealtimeKindRealtime},
			Surface: domain.OpenAIRealtimeSocketSurface(),
		})
		if err != nil {
			socket.refuse(err)
			return
		}
		var subprotocols []string
		if slices.Contains(offeredSubprotocols(r), realtimeSubprotocol) {
			subprotocols = []string{realtimeSubprotocol}
		}
		socket.relay(voicesession.RelayCall{
			Ticket:             ticket,
			Path:               "/v1/realtime",
			RawQuery:           url.Values{"model": {gjson.GetBytes(ticket.Body, "session.model").String()}}.Encode(),
			Header:             bearerHeader(ticket.Session.Credential),
			Subprotocols:       subprotocols,
			ClientSubprotocols: subprotocols,
		})
	}
}

// realtimeSocketSession reads the model a Realtime socket names and builds
// the session body the pipeline resolves it in.
func realtimeSocketSession(r *http.Request) (string, []byte, error) {
	model := strings.TrimSpace(r.URL.Query().Get("model"))
	if model == "" {
		return "", nil, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"message": "the model query parameter is required", "fault": "customer",
		})
	}
	body, err := sonic.Marshal(map[string]any{"session": map[string]string{"type": "realtime", "model": model}})
	if err != nil {
		return "", nil, herr.New(r.Context(), domain.ErrInternal, herr.M{"fault": "gateway"})
	}
	return model, body, nil
}

// elevenLabsSocket is what tells the ElevenLabs sockets apart.
type elevenLabsSocket struct {
	kind         domain.RealtimeSessionKind
	surface      domain.Surface
	defaultModel string
	// count builds the meter for one socket from its query string.
	count func(query url.Values) func(frame []byte) int64
}

func elevenLabsSpeechSocket() elevenLabsSocket {
	return elevenLabsSocket{
		kind:         domain.RealtimeKindTTSSocket,
		surface:      domain.ElevenLabsSpeechSocketSurface(),
		defaultModel: domain.ElevenLabsTokenTTSWebsocket.DefaultModel(),
		count:        func(url.Values) func([]byte) int64 { return voicesession.CountSpeechChars },
	}
}

func elevenLabsDialogSocket() elevenLabsSocket {
	socket := elevenLabsSpeechSocket()
	socket.defaultModel = domain.ElevenLabsTokenTTDWebsocket.DefaultModel()
	return socket
}

func elevenLabsTranscriptionSocket() elevenLabsSocket {
	return elevenLabsSocket{
		kind:         domain.RealtimeKindSTTSocket,
		surface:      domain.ElevenLabsTranscriptionSocketSurface(),
		defaultModel: domain.ElevenLabsTokenRealtimeScribe.DefaultModel(),
		count: func(query url.Values) func([]byte) int64 {
			return voicesession.CountAudio(voicesession.AudioBytesPerSecond(query.Get("audio_format")))
		},
	}
}

// elevenLabsSocketHandler terminates the ElevenLabs sockets. They report no
// usage, so the text or audio the client sends is counted as it passes.
func elevenLabsSocketHandler(deps RouterDeps, kind elevenLabsSocket) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		socket := voiceSocket{deps: deps, w: w, r: r}
		bundle, ok := socket.begin()
		if !ok {
			return
		}
		query := r.URL.Query()
		named := strings.TrimSpace(query.Get(domain.ElevenLabsModelField))
		model := named
		if model == "" {
			model = kind.defaultModel
		}
		body, err := sonic.Marshal(map[string]string{"model": model})
		if err != nil {
			socket.refuse(herr.New(r.Context(), domain.ErrInternal, herr.M{"fault": "gateway"}))
			return
		}
		ticket, err := socket.book(bundle, app.RealtimeMintDispatch{
			Body:    body,
			Model:   model,
			Session: domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorElevenLabs, RelayKind: kind.kind},
			Surface: kind.surface,
		})
		if err != nil {
			socket.refuse(err)
			return
		}
		resolved := ""
		if named != "" {
			resolved = ticket.Model
		}
		header := http.Header{}
		header.Set("xi-api-key", ticket.Session.Credential.APIKey)
		socket.relay(voicesession.RelayCall{
			Ticket:     ticket,
			Path:       r.URL.Path,
			RawQuery:   elevenLabsSocketQuery(r.URL.RawQuery, resolved),
			Header:     header,
			FirstFrame: voicesession.StripSocketKeys,
			Count:      kind.count(query),
		})
	}
}

// elevenLabsSocketQuery is the client's query string as it goes upstream:
// the key parameters removed, the model replaced by the resolved one when the
// client named one, and every other parameter as it was written.
func elevenLabsSocketQuery(raw, resolvedModel string) string {
	kept := make([]string, 0, 8)
	for _, pair := range strings.Split(raw, "&") {
		name, _, _ := strings.Cut(pair, "=")
		if decoded, err := url.QueryUnescape(name); err == nil {
			name = decoded
		}
		switch name {
		case "":
		case "authorization", "xi-api-key", "xi_api_key":
		case domain.ElevenLabsModelField:
			if resolvedModel != "" {
				pair = domain.ElevenLabsModelField + "=" + url.QueryEscape(resolvedModel)
			}
			kept = append(kept, pair)
		default:
			kept = append(kept, pair)
		}
	}
	return strings.Join(kept, "&")
}
