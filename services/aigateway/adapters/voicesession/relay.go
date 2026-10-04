package voicesession

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The relay carries a vendor WebSocket through this process for clients on
// the WebSocket transport, where the vendor socket needs the provider key. A
// relayed socket is a supervised session like a brokered call: same slot, same
// report queue, same key watch, same drain (ADR-097).

// ReasonClientClosed means the client ended a relayed socket.
const ReasonClientClosed = "client_closed"

const (
	// relayReadLimit caps one message in either direction. Audio frames are
	// base64 and can run to megabytes.
	relayReadLimit = 16 << 20
	// relayInlineBytes is the largest message relayed as one frame from one
	// buffer. A larger one is streamed through in chunks.
	relayInlineBytes = 1 << 20
	// relayKeepBytes is the largest buffer a pump keeps between messages.
	relayKeepBytes = 64 << 10
	// relayWriteTimeout is how long one side may take to accept a message.
	relayWriteTimeout = 30 * time.Second
	// relayStreamTimeout bounds one message too large to relay inline.
	relayStreamTimeout = 2 * time.Minute
)

const relayBudgetFrame = `{"type":"error","error":{"type":"budget_exceeded","code":"budget_exceeded",` +
	`"message":"The budget on this key is exhausted, so the gateway is closing this session."}}`

// RelayCall is one relayed socket: the booked session and how to open the
// vendor's side of it.
type RelayCall struct {
	Ticket *domain.VoiceRelayTicket
	// Path and RawQuery name the vendor socket on the credential's host.
	Path     string
	RawQuery string
	// Header authenticates the vendor socket with the provider key.
	Header http.Header
	// Subprotocols are offered to the vendor; ClientSubprotocols are the ones
	// the client may be answered with.
	Subprotocols       []string
	ClientSubprotocols []string
	// Client is set when the route had to accept the client socket first.
	Client *websocket.Conn
	// Opening is sent to the vendor ahead of everything the client sends.
	Opening []byte
	// FirstFrame rewrites the first client text frame. Nil leaves it alone.
	FirstFrame func(frame []byte) []byte
	// Count reads what one client text frame adds to the session's meter, on
	// sockets whose vendor reports no usage. Nil counts nothing.
	Count func(frame []byte) int64
}

// Available refuses with ErrVoiceBrokerUnavailable when a relayed socket
// would not be admitted. It takes nothing: Admit is what decides.
func (m *Manager) Available(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch {
	case m.draining:
		return brokerUnavailable(ctx, "this gateway instance is shutting down and takes no new voice calls: retry, and another instance will answer")
	case m.admitted >= m.maxSessions:
		return brokerUnavailable(ctx, "this gateway instance already supervises its maximum number of voice calls: retry shortly")
	}
	return nil
}

// Relay dials the vendor, upgrades the client and relays until the call ends.
// It returns an error only while the booking was released and nothing was
// relayed; a client it already upgraded has been closed by then.
func (m *Manager) Relay(w http.ResponseWriter, req *http.Request, call RelayCall) error {
	ctx := req.Context()
	ticket := call.Ticket
	own, ok := ticket.Slot.(*slot)
	if !ok || own.manager != m || m.relayEndpoint == nil {
		ticket.Release(ctx, "relay_unavailable")
		return brokerUnavailable(ctx, "relayed voice sockets are not available on this gateway")
	}
	vendor, err := m.dialRelay(ctx, call)
	if err != nil {
		ticket.Release(ctx, "dial_failed")
		return err
	}
	client := call.Client
	if client == nil {
		// The virtual key authenticates the socket, not a cookie, so a page
		// on another origin holds nothing a cross-site request could borrow.
		client, err = websocket.Accept(w, req, &websocket.AcceptOptions{
			Subprotocols:       call.ClientSubprotocols,
			InsecureSkipVerify: true,
		})
		if err != nil {
			_ = vendor.CloseNow()
			ticket.Release(ctx, "upgrade_failed")
			//nolint:nilerr // Accept already answered the client over HTTP.
			return nil
		}
	}
	client.SetReadLimit(relayReadLimit)

	var held *session
	own.once.Do(func() { held = m.track(ticket.Session) })
	if held == nil {
		_ = vendor.CloseNow()
		_ = client.Close(websocket.StatusInternalError, "relay_unavailable")
		return nil
	}
	if ticket.Opened != nil {
		ticket.Opened()
	}
	held.attached = true
	newRelay(held, call, [2]*websocket.Conn{client, vendor}).serve()
	return nil
}

// dialRelay opens the vendor socket through the endpoint policy client.
func (m *Manager) dialRelay(ctx context.Context, call RelayCall) (*websocket.Conn, error) {
	target := m.relayEndpoint(call.Ticket.Session.Credential, call.Path)
	if call.RawQuery != "" {
		target += "?" + call.RawQuery
	}
	ctx, cancel := context.WithTimeout(ctx, m.timing.CallTimeout)
	defer cancel()
	//nolint:bodyclose // coder/websocket closes the handshake response body itself.
	vendor, resp, err := websocket.Dial(ctx, target, &websocket.DialOptions{
		HTTPClient:   m.vendor.client,
		HTTPHeader:   call.Header,
		Subprotocols: call.Subprotocols,
	})
	if err != nil {
		meta := herr.M{"reason": "the provider did not open the socket", "fault": "provider"}
		if resp != nil {
			meta["upstream_status"] = resp.StatusCode
		}
		m.logger.Warn("voice_relay_dial_failed",
			zap.String("session_id", call.Ticket.Session.SessionID), zap.Error(err))
		return nil, herr.New(ctx, domain.ErrProviderError, meta)
	}
	vendor.SetReadLimit(relayReadLimit)
	if len(call.Opening) > 0 {
		if err := vendor.Write(ctx, websocket.MessageText, call.Opening); err != nil {
			_ = vendor.CloseNow()
			return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
				"reason": "the provider socket closed before the session started", "fault": "provider",
			})
		}
	}
	return vendor, nil
}

type relaySide int

const (
	sideClient relaySide = iota
	sideVendor
)

func (side relaySide) other() relaySide { return 1 - side }

// pumpEnd is why one direction stopped: the pump it was, the side that
// failed, and the error it failed with.
type pumpEnd struct {
	pump relaySide
	side relaySide
	err  error
}

// relay is one relayed socket. Its serve goroutine owns the session; the two
// pumps reach it only through the channels and the atomics.
type relay struct {
	s      *session
	call   RelayCall
	conns  [2]*websocket.Conn
	ctx    context.Context
	cancel context.CancelFunc
	events chan Event
	ended  chan pumpEnd
	pumps  sync.WaitGroup

	// clientGone stops frames to a client that is being closed.
	clientGone atomic.Bool
	// units is what the client frames counted so far.
	units    atomic.Int64
	counter  relayCounter
	vendorUp bool
}

// newRelay takes the two sockets as client, then vendor.
func newRelay(s *session, call RelayCall, conns [2]*websocket.Conn) *relay {
	ctx, cancel := context.WithCancel(context.Background())
	return &relay{
		s: s, call: call, conns: conns,
		ctx: ctx, cancel: cancel,
		events:   make(chan Event, 64),
		ended:    make(chan pumpEnd, 2),
		counter:  newRelayCounter(s.Kind),
		vendorUp: true,
	}
}

// serve relays until the call ends, then closes both sockets and the record.
func (r *relay) serve() {
	s := r.s
	s.manager.logger.Info("voice_relay_started",
		zap.String("session_id", s.SessionID), zap.String("kind", string(s.Kind)))
	r.pumps.Add(2)
	go r.pump(sideClient)
	go r.pump(sideVendor)

	reason, end := r.supervise()
	r.close(reason, end)
	r.cancel()
	_ = r.conns[sideClient].CloseNow()
	_ = r.conns[sideVendor].CloseNow()
	r.pumps.Wait()
	r.drain()
	r.count(true)

	s.finalize(reason)
	s.manager.logger.Info("voice_relay_ended",
		zap.String("session_id", s.SessionID),
		zap.String("kind", string(s.Kind)),
		zap.String("reason", reason),
		zap.Duration("duration", time.Since(s.StartedAt)),
	)
	s.manager.finished(s, reason)
}

// supervise runs the session's checks beside the pumps and answers why the
// call ends.
func (r *relay) supervise() (string, pumpEnd) {
	s := r.s
	ticker := time.NewTicker(s.manager.timing.Tick)
	defer ticker.Stop()
	for {
		select {
		case event := <-r.events:
			s.record(event)
			if reason := s.flush(false); reason != "" {
				return reason, pumpEnd{}
			}
		case end := <-r.ended:
			return r.pumpStopped(end), end
		case <-ticker.C:
			r.count(false)
			if reason := s.housekeeping(); reason != "" {
				return reason, pumpEnd{}
			}
		case reason := <-s.end:
			return reason, pumpEnd{}
		}
	}
}

// pumpStopped answers the reason a stopped pump ends the call with: the
// side whose socket failed is the side that closed it.
func (r *relay) pumpStopped(end pumpEnd) string {
	r.drain()
	if end.pump == sideVendor {
		r.vendorUp = false
	}
	if end.side == sideVendor {
		return ReasonVendorClosed
	}
	return ReasonClientClosed
}

// drain records the events the vendor pump passed on and nobody read yet.
func (r *relay) drain() {
	for {
		select {
		case event := <-r.events:
			r.s.record(event)
		default:
			return
		}
	}
}

// close tells each side the call is over. A close one side sent is passed to
// the other with its code and reason.
func (r *relay) close(reason string, end pumpEnd) {
	switch reason {
	case ReasonVendorClosed:
		code, text := closeOf(end.err, websocket.StatusInternalError, "provider_connection_lost")
		_ = r.conns[sideClient].Close(code, text)
	case ReasonClientClosed:
		r.clientGone.Store(true)
		code, text := closeOf(end.err, websocket.StatusNormalClosure, "")
		r.endVendor(code, text)
	default:
		r.clientGone.Store(true)
		dismissed := make(chan struct{})
		go func() {
			defer close(dismissed)
			r.dismiss(reason)
		}()
		r.endVendor(websocket.StatusNormalClosure, "")
		<-dismissed
	}
}

// dismiss closes the client for a reason of the gateway's own.
func (r *relay) dismiss(reason string) {
	client := r.conns[sideClient]
	code := websocket.StatusCode(domain.RelayClosePolicy)
	switch reason {
	case ReasonBudgetExceeded:
		ctx, cancel := context.WithTimeout(r.ctx, r.s.manager.timing.CallTimeout)
		_ = client.Write(ctx, websocket.MessageText, []byte(relayBudgetFrame))
		cancel()
	case ReasonDrain:
		code, reason = websocket.StatusCode(domain.RelayCloseRestart), "service_restart"
	}
	_ = client.Close(code, reason)
}

// endVendor ends the vendor's side. A Live session is asked to close first,
// which is how its final duration is reported.
func (r *relay) endVendor(code websocket.StatusCode, text string) {
	if !r.vendorUp {
		return
	}
	vendor, timing := r.conns[sideVendor], r.s.manager.timing
	if r.s.Kind == domain.RealtimeKindLive {
		ctx, cancel := context.WithTimeout(r.ctx, timing.CallTimeout)
		err := vendor.Write(ctx, websocket.MessageText, []byte(`{"type":"session.close"}`))
		cancel()
		if err == nil && r.awaitVendor(timing.CloseWait) {
			return
		}
	}
	_ = vendor.Close(code, text)
}

// awaitVendor keeps recording until the vendor pump stops or the wait runs
// out, and reports whether it stopped.
func (r *relay) awaitVendor(wait time.Duration) bool {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case event := <-r.events:
			r.s.record(event)
		case end := <-r.ended:
			if end.pump == sideVendor {
				r.drain()
				r.vendorUp = false
				return true
			}
		case <-timer.C:
			return false
		}
	}
}

// closeOf reads the close a socket ended with. An error that is no close
// frame, or a code that cannot be sent, takes the fallback.
func closeOf(err error, fallback websocket.StatusCode, fallbackText string) (websocket.StatusCode, string) {
	var closed websocket.CloseError
	if !errors.As(err, &closed) {
		return fallback, fallbackText
	}
	switch code := closed.Code; {
	case code == websocket.StatusNoStatusRcvd:
		return code, ""
	case code >= 1000 && code <= 1014 && code != 1004 && code != 1006, code >= 3000 && code <= 4999:
		return code, truncateCloseReason(closed.Reason)
	default:
		return fallback, fallbackText
	}
}

// truncateCloseReason holds a reason to what a close frame can carry.
func truncateCloseReason(reason string) string {
	const maxCloseReason = 123
	if len(reason) <= maxCloseReason {
		return reason
	}
	cut := maxCloseReason
	for cut > 0 && reason[cut]&0xC0 == 0x80 {
		cut--
	}
	return reason[:cut]
}

// pump relays messages from one side to the other until either fails.
func (r *relay) pump(from relaySide) {
	defer r.pumps.Done()
	src := r.conns[from]
	var buf bytes.Buffer
	first := true
	for {
		kind, reader, err := src.Reader(r.ctx)
		if err != nil {
			r.ended <- pumpEnd{pump: from, side: from, err: err}
			return
		}
		side, err := r.forward(relayMessage{from: from, kind: kind, first: first}, reader, &buf)
		if err != nil {
			r.ended <- pumpEnd{pump: from, side: side, err: err}
			return
		}
		first = false
		if buf.Cap() > relayKeepBytes {
			buf = bytes.Buffer{}
		}
	}
}

// relayMessage is one message on its way through: where it came from, its
// type, and whether it is the first that side sent.
type relayMessage struct {
	from  relaySide
	kind  websocket.MessageType
	first bool
}

func (m relayMessage) text() bool { return m.kind == websocket.MessageText }

// forward relays one message with its type and bytes unchanged, and answers
// the side that failed. Only a message the relay reads is held whole.
func (r *relay) forward(message relayMessage, reader io.Reader, buf *bytes.Buffer) (relaySide, error) {
	from := message.from
	buf.Reset()
	if _, err := buf.ReadFrom(io.LimitReader(reader, relayInlineBytes+1)); err != nil {
		return from, err
	}
	if buf.Len() > relayInlineBytes {
		if !r.reads(message, buf.Bytes()) {
			return r.stream(message, buf.Bytes(), reader)
		}
		if _, err := buf.ReadFrom(reader); err != nil {
			return from, err
		}
	}
	frame := buf.Bytes()
	if err := r.write(from.other(), message.kind, r.outgoing(message, frame)); err != nil {
		return from.other(), err
	}
	if from == sideVendor && message.text() {
		r.observe(frame)
	}
	return from, nil
}

// outgoing is the frame as it leaves: a client text frame counted and, when
// it is the first, rewritten; every other frame as it came in.
func (r *relay) outgoing(message relayMessage, frame []byte) []byte {
	if message.from != sideClient || !message.text() {
		return frame
	}
	return r.clientFrame(frame, message.first)
}

// reads reports whether the relay has to see the whole of a text message.
func (r *relay) reads(message relayMessage, head []byte) bool {
	if !message.text() {
		return false
	}
	if message.from == sideClient {
		return r.call.Count != nil || (message.first && r.call.FirstFrame != nil)
	}
	return r.observes() && !r.s.skips(head[:min(len(head), eventHeadBytes)])
}

// observes reports whether the vendor's events on this socket carry usage.
func (r *relay) observes() bool {
	return r.s.Kind == domain.RealtimeKindLive || r.s.Kind == domain.RealtimeKindRealtime
}

// clientFrame counts a client text frame and applies the first-frame rewrite.
// Every other client frame goes out as it came in.
func (r *relay) clientFrame(frame []byte, first bool) []byte {
	if r.call.Count != nil {
		r.units.Add(r.call.Count(frame))
	}
	if first && r.call.FirstFrame != nil {
		return r.call.FirstFrame(frame)
	}
	return frame
}

// observe peeks at a vendor event already sent on to the client. Only ids
// and usage counts are read, and nothing of the frame is kept.
func (r *relay) observe(frame []byte) {
	if !r.observes() || r.s.skips(frame[:min(len(frame), eventHeadBytes)]) {
		return
	}
	event := r.s.observeFrame(frame)
	if event.Usage == nil && !event.HasSeconds && !event.Closed {
		return
	}
	select {
	case r.events <- event:
	case <-r.ctx.Done():
	}
}

func (r *relay) write(to relaySide, kind websocket.MessageType, frame []byte) error {
	if to == sideClient && r.clientGone.Load() {
		return nil
	}
	ctx, cancel := context.WithTimeout(r.ctx, relayWriteTimeout)
	defer cancel()
	return r.conns[to].Write(ctx, kind, frame)
}

// stream relays a message too large to hold, chunk by chunk.
func (r *relay) stream(message relayMessage, head []byte, reader io.Reader) (relaySide, error) {
	from, to := message.from, message.from.other()
	if to == sideClient && r.clientGone.Load() {
		_, err := io.Copy(io.Discard, reader)
		return from, err
	}
	ctx, cancel := context.WithTimeout(r.ctx, relayStreamTimeout)
	defer cancel()
	writer, err := r.conns[to].Writer(ctx, message.kind)
	if err != nil {
		return to, err
	}
	if _, err := writer.Write(head); err != nil {
		return to, err
	}
	if readErr, writeErr := copyChunks(writer, reader); readErr != nil || writeErr != nil {
		if readErr != nil {
			return from, readErr
		}
		return to, writeErr
	}
	if err := writer.Close(); err != nil {
		return to, err
	}
	return from, nil
}

// copyChunks copies src to dst and keeps the two failures apart, because
// each one names a different side of the relay.
func copyChunks(dst io.Writer, src io.Reader) (readErr, writeErr error) {
	chunk := make([]byte, 32<<10)
	for {
		n, err := src.Read(chunk)
		if n > 0 {
			if _, writeErr := dst.Write(chunk[:n]); writeErr != nil {
				return nil, writeErr
			}
		}
		if errors.Is(err, io.EOF) {
			return nil, nil
		}
		if err != nil {
			return err, nil
		}
	}
}

// count queues what the client frames counted since the last report. A new
// report is offered at most once per usage interval unless force is set.
func (r *relay) count(force bool) {
	if r.call.Count == nil {
		return
	}
	minInterval := r.s.manager.timing.UsageInterval
	if force {
		minInterval = 0
	}
	if observation, ok := r.counter.pending(r.units.Load(), time.Now(), minInterval); ok {
		r.s.enqueue(observation)
	}
}
