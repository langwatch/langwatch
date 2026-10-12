package mediarelay

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/coder/websocket"
	"go.uber.org/zap"
)

// pingTimeout bounds one ping of a relay waiting for Twilio.
const pingTimeout = 10 * time.Second

type side int

const (
	sideWorker side = iota
	sideTwilio
)

// pumpEnd is why a pump stopped and which socket failed.
type pumpEnd struct {
	side side
	err  error
}

// closeFrame is how a socket is told the relay is over. A zero code means
// the socket is already closed and is only released.
type closeFrame struct {
	code   websocket.StatusCode
	reason string
}

// ending is how a relay ends: the outcome to count, if any, and the close
// each socket gets.
type ending struct {
	outcome string
	worker  closeFrame
	twilio  closeFrame
}

// relay is one worker socket waiting for, or joined to, Twilio's socket.
type relay struct {
	hub    *Hub
	scope  string
	random [16]byte

	// claimed is guarded by the hub's lock.
	claimed     bool
	releaseOnce sync.Once
	// joined hands Twilio's socket over; nil means Twilio's upgrade failed.
	joined chan *websocket.Conn
	// done closes when the slot is released.
	done chan struct{}

	ctx    context.Context
	cancel context.CancelFunc
	worker *websocket.Conn
	twilio *websocket.Conn
	// paired closes once twilio is set, which lets the worker pump forward.
	paired chan struct{}
	ends   chan pumpEnd
}

func newRelay(h *Hub, scope string, random [16]byte) *relay {
	ctx, cancel := context.WithCancel(context.Background())
	return &relay{
		hub: h, scope: scope, random: random,
		joined: make(chan *websocket.Conn),
		done:   make(chan struct{}),
		ctx:    ctx, cancel: cancel,
		paired: make(chan struct{}),
		ends:   make(chan pumpEnd, 2),
	}
}

// serve runs the relay on the worker's socket until it ends. Frame payloads
// are never logged.
func (rl *relay) serve(worker *websocket.Conn, id string) {
	h := rl.hub
	rl.worker = worker
	started := time.Now()
	h.logger.Info("voice_media_relay_opened", zap.String("relay", idPrefix(id)))
	end := rl.run(id)
	h.logger.Info("voice_media_relay_ended",
		zap.String("relay", idPrefix(id)), zap.String("outcome", end.outcome),
		zap.Duration("duration", time.Since(started)))
	rl.finish(end)
}

func (rl *relay) run(id string) ending {
	if err := rl.sendReady(id); err != nil {
		return ending{}
	}
	go rl.pump(sideWorker)
	twilio, end, joined := rl.awaitTwilio()
	if !joined {
		return end
	}
	rl.twilio = twilio
	close(rl.paired)
	rl.hub.metrics.RecordVoiceMediaRelay(OutcomePaired)
	rl.hub.logger.Info("voice_media_relay_paired")
	go rl.pump(sideTwilio)
	return rl.awaitEnd()
}

// sendReady tells the worker where Twilio must connect.
func (rl *relay) sendReady(id string) error {
	frame, err := json.Marshal(map[string]any{
		"event":              "langwatch.relay.ready",
		"relay_id":           id,
		"stream_path":        "/v1/voice/twilio/" + id,
		"expires_in_seconds": int(rl.hub.pendingTTL / time.Second),
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(rl.ctx, writeTimeout)
	defer cancel()
	return rl.worker.Write(ctx, websocket.MessageText, frame)
}

// awaitTwilio waits for Twilio's socket, pinging the worker meanwhile.
func (rl *relay) awaitTwilio() (*websocket.Conn, ending, bool) {
	h := rl.hub
	expiry := time.NewTimer(h.pendingTTL)
	defer expiry.Stop()
	ping := time.NewTicker(h.pingInterval)
	defer ping.Stop()
	for {
		select {
		case conn := <-rl.joined:
			if conn == nil {
				return nil, ending{outcome: OutcomeDropped, worker: closeFrame{ClosePeerLost, "relay_peer_lost"}}, false
			}
			return conn, ending{}, true
		case <-expiry.C:
			return nil, ending{outcome: OutcomeExpiredUnpaired, worker: closeFrame{CloseExpired, "relay_expired"}}, false
		case <-ping.C:
			go rl.ping()
		case <-rl.ends:
			return nil, ending{}, false
		case <-h.drainOver:
			return nil, ending{worker: closeFrame{CloseDrain, "relay_drain"}}, false
		}
	}
}

// ping keeps a waiting relay from idling out, and drops a worker that has
// stopped answering.
func (rl *relay) ping() {
	ctx, cancel := context.WithTimeout(rl.ctx, pingTimeout)
	defer cancel()
	if err := rl.worker.Ping(ctx); err != nil {
		_ = rl.worker.CloseNow()
	}
}

// awaitEnd waits for a paired relay to end, by a socket, its maximum
// duration, or the drain.
func (rl *relay) awaitEnd() ending {
	h := rl.hub
	limit := time.NewTimer(h.maxDuration)
	defer limit.Stop()
	normal := closeFrame{websocket.StatusNormalClosure, ""}
	select {
	case end := <-rl.ends:
		return endingOf(end)
	case <-limit.C:
		return ending{outcome: OutcomeCompleted, worker: closeFrame{CloseMaxDuration, "relay_max_duration"}, twilio: normal}
	case <-h.drainOver:
		return ending{outcome: OutcomeCompleted, worker: closeFrame{CloseDrain, "relay_drain"}, twilio: normal}
	}
}

// endingOf maps a pump stopping to how each socket is closed. The socket
// that failed has been closed by the library already, so it is only released.
func endingOf(end pumpEnd) ending {
	normal := closeFrame{websocket.StatusNormalClosure, ""}
	graceful := isNormalClose(end.err)
	tooBig := errors.Is(end.err, websocket.ErrMessageTooBig)
	if end.side == sideTwilio {
		switch {
		case tooBig:
			return ending{outcome: OutcomeDropped, worker: closeFrame{websocket.StatusMessageTooBig, "frame_too_big"}}
		case graceful:
			return ending{outcome: OutcomeCompleted, worker: normal}
		}
		return ending{outcome: OutcomeDropped, worker: closeFrame{ClosePeerLost, "relay_peer_lost"}}
	}
	if graceful {
		return ending{outcome: OutcomeCompleted, twilio: normal}
	}
	return ending{outcome: OutcomeDropped, twilio: normal}
}

func isNormalClose(err error) bool {
	var closed websocket.CloseError
	if !errors.As(err, &closed) {
		return false
	}
	//nolint:exhaustive // only the three graceful codes matter; every other code is abnormal.
	switch closed.Code {
	case websocket.StatusNormalClosure, websocket.StatusGoingAway, websocket.StatusNoStatusRcvd:
		return true
	}
	return false
}

// finish counts the outcome and gives the slot back before it touches either
// socket, so a peer that is slow to answer its close holds neither up.
func (rl *relay) finish(end ending) {
	if end.outcome != "" {
		rl.hub.metrics.RecordVoiceMediaRelay(end.outcome)
	}
	rl.hub.release(rl)
	var closing sync.WaitGroup
	for conn, frame := range map[*websocket.Conn]closeFrame{rl.worker: end.worker, rl.twilio: end.twilio} {
		if conn == nil {
			continue
		}
		closing.Add(1)
		go func() {
			defer closing.Done()
			if frame.code == 0 {
				_ = conn.CloseNow()
				return
			}
			_ = conn.Close(frame.code, frame.reason)
		}()
	}
	// The pumps read until the closes are over: canceling earlier would cut
	// the connection before its close frame goes out.
	go func() {
		closing.Wait()
		rl.cancel()
	}()
}

// pump moves messages from one socket to the other, verbatim and in order,
// until either fails. The worker's pump holds a message read before Twilio
// joined until Twilio does.
func (rl *relay) pump(from side) {
	for {
		kind, data, err := rl.source(from).Read(rl.ctx)
		if err != nil {
			rl.ends <- pumpEnd{side: from, err: err}
			return
		}
		dst, ok := rl.destination(from)
		if !ok {
			return
		}
		if err := rl.write(dst, kind, data); err != nil {
			rl.ends <- pumpEnd{side: 1 - from, err: err}
			return
		}
	}
}

func (rl *relay) source(from side) *websocket.Conn {
	if from == sideTwilio {
		return rl.twilio
	}
	return rl.worker
}

// destination waits for Twilio to join when the worker speaks first.
func (rl *relay) destination(from side) (*websocket.Conn, bool) {
	if from != sideWorker {
		return rl.worker, true
	}
	select {
	case <-rl.paired:
		return rl.twilio, true
	case <-rl.ctx.Done():
		return nil, false
	}
}

func (rl *relay) write(dst *websocket.Conn, kind websocket.MessageType, data []byte) error {
	ctx, cancel := context.WithTimeout(rl.ctx, writeTimeout)
	defer cancel()
	return dst.Write(ctx, kind, data)
}
