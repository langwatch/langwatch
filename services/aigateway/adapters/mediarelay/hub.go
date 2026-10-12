package mediarelay

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The outcomes counted in gateway_voice_media_relay_total. The set is fixed:
// an id or a scope in a label would be unbounded.
const (
	OutcomeOpened          = "opened"
	OutcomePaired          = "paired"
	OutcomeRefusedAuth     = "refused_auth"
	OutcomeRefusedUnknown  = "refused_unknown"
	OutcomeRefusedExpired  = "refused_expired"
	OutcomeRefusedReplay   = "refused_replay"
	OutcomeRefusedUnpaired = "refused_unpaired"
	OutcomeExpiredUnpaired = "expired_unpaired"
	OutcomeDropped         = "dropped"
	OutcomeCompleted       = "completed"
)

// Close codes a worker is told. 1000, 1009 and 1012 are the standard ones.
const (
	CloseExpired     = websocket.StatusCode(4408)
	CloseMaxDuration = websocket.StatusCode(4409)
	ClosePeerLost    = websocket.StatusCode(4502)
	CloseDrain       = websocket.StatusCode(1012)
)

const (
	// readLimit caps one message either way. Twilio media frames are far smaller.
	readLimit = 64 << 10
	// writeTimeout is how long one side may take to accept a message.
	writeTimeout = 10 * time.Second

	defaultPendingTTL         = 150 * time.Second
	defaultMaxRelayDuration   = 330 * time.Second
	defaultPingInterval       = 20 * time.Second
	defaultDrainBudget        = 570 * time.Second
	defaultMaxRelays          = 500
	defaultMaxPendingPerScope = 20
	defaultMaxRelaysPerScope  = 50
	// stopAllowance is what closing the remaining relays takes after the budget.
	stopAllowance = 10 * time.Second
)

// Metrics counts relay outcomes.
type Metrics interface {
	RecordVoiceMediaRelay(outcome string)
}

type discardMetrics struct{}

func (discardMetrics) RecordVoiceMediaRelay(string) {}

// Options configures a Hub. A zero field takes its default.
type Options struct {
	// Secret keys the relay ids (LW_GATEWAY_INTERNAL_SECRET).
	Secret string
	// PodIP and BootID name this pod inside every id it mints. PodIP empty
	// means a single-pod gateway; BootID empty draws a random one.
	PodIP  string
	BootID string
	// PendingTTL is how long an opened relay waits for Twilio.
	PendingTTL time.Duration
	// MaxRelayDuration caps a paired relay, from the join.
	MaxRelayDuration time.Duration
	// PingInterval is how often a relay waiting for Twilio is pinged, so an
	// idle-timeout in front of the gateway does not cut it.
	PingInterval time.Duration
	// DrainBudget is how long paired relays may run once BeginDrain is called.
	DrainBudget time.Duration
	// MaxRelays caps the relays held at once; MaxPendingPerScope caps those
	// of one instance or organization still waiting for Twilio, and
	// MaxRelaysPerScope all it holds, paired or not.
	MaxRelays          int
	MaxPendingPerScope int
	MaxRelaysPerScope  int
	Logger             *zap.Logger
	Metrics            Metrics
}

// Hub holds the relays of this process: it admits them, hands out sealed
// ids, joins each to the Twilio socket that dials in with that id, and drains
// on shutdown. A relay is held from its open to its end.
type Hub struct {
	codec   *IDCodec
	podIP   string
	bootID  string
	logger  *zap.Logger
	metrics Metrics

	pendingTTL, maxDuration, pingInterval, drainBudget time.Duration
	maxRelays, maxPending, maxRelaysPerScope           int

	mu     sync.Mutex
	relays map[[16]byte]*relay
	// scopes counts a scope's relays still waiting for Twilio; held, all of them.
	scopes     map[string]int
	held       map[string]int
	active     int
	draining   bool
	drainTimer *time.Timer
	// drainOver closes when the drain budget is spent.
	drainOver chan struct{}
	endDrain  sync.Once
	wg        sync.WaitGroup
}

// NewHub builds a Hub.
func NewHub(opts Options) *Hub {
	h := &Hub{
		codec:             NewIDCodec(opts.Secret),
		podIP:             opts.PodIP,
		bootID:            opts.BootID,
		logger:            opts.Logger,
		metrics:           opts.Metrics,
		pendingTTL:        orDuration(opts.PendingTTL, defaultPendingTTL),
		maxDuration:       orDuration(opts.MaxRelayDuration, defaultMaxRelayDuration),
		pingInterval:      orDuration(opts.PingInterval, defaultPingInterval),
		drainBudget:       orDuration(opts.DrainBudget, defaultDrainBudget),
		maxRelays:         orInt(opts.MaxRelays, defaultMaxRelays),
		maxPending:        orInt(opts.MaxPendingPerScope, defaultMaxPendingPerScope),
		maxRelaysPerScope: orInt(opts.MaxRelaysPerScope, defaultMaxRelaysPerScope),
		relays:            make(map[[16]byte]*relay),
		scopes:            make(map[string]int),
		held:              make(map[string]int),
		drainOver:         make(chan struct{}),
	}
	if h.logger == nil {
		h.logger = zap.NewNop()
	}
	if h.metrics == nil {
		h.metrics = discardMetrics{}
	}
	if h.bootID == "" {
		boot := make([]byte, 4)
		_, _ = rand.Read(boot)
		h.bootID = hex.EncodeToString(boot)
	}
	return h
}

func orDuration(value, fallback time.Duration) time.Duration {
	if value <= 0 {
		return fallback
	}
	return value
}

func orInt(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}

// Active is how many relays are held.
func (h *Hub) Active() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.active
}

// RecordRefusedAuth counts a relay open the credential check turned away.
func (h *Hub) RecordRefusedAuth() { h.metrics.RecordVoiceMediaRelay(OutcomeRefusedAuth) }

func (h *Hub) String() string { return "voice-media-relay" }

// Start begins the drain when ctx ends, which is the moment shutdown is
// signaled and before the listener stops.
func (h *Hub) Start(ctx context.Context) error {
	go func() {
		<-ctx.Done()
		h.BeginDrain()
	}()
	return nil
}

// StopBudget is the deadline Stop needs, which is longer than a request's.
func (h *Hub) StopBudget() time.Duration { return h.drainBudget + stopAllowance }

// Stop waits for every relay to end. The drain clock ends the ones still
// running, so a Stop that outlives it returns with nothing held.
func (h *Hub) Stop(ctx context.Context) error {
	h.BeginDrain()
	idle := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(idle)
	}()
	select {
	case <-idle:
		return nil
	case <-ctx.Done():
		h.endDrain.Do(func() { close(h.drainOver) })
		return ctx.Err()
	}
}

// BeginDrain refuses new relays and starts the drain clock. Relays still
// held when it runs out are closed with 1012. A relay waiting for Twilio can
// still be joined meanwhile.
func (h *Hub) BeginDrain() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.draining {
		return
	}
	h.draining = true
	h.logger.Info("voice_media_relay_draining",
		zap.Int("active", h.active), zap.Duration("drain_budget", h.drainBudget))
	h.drainTimer = time.AfterFunc(h.drainBudget, func() { h.endDrain.Do(func() { close(h.drainOver) }) })
}

// Open admits a relay for scope and upgrades w into its worker socket, then
// serves the relay until it ends. It returns an error only while nothing was
// upgraded, so the caller can answer it over HTTP.
func (h *Hub) Open(w http.ResponseWriter, r *http.Request, scope string) error {
	rl, id, err := h.admit(r.Context(), scope)
	if err != nil {
		return err
	}
	worker, err := websocket.Accept(w, r, acceptOptions())
	if err != nil {
		rl.cancel()
		h.release(rl)
		//nolint:nilerr // Accept already answered the request over HTTP.
		return nil
	}
	worker.SetReadLimit(readLimit)
	h.metrics.RecordVoiceMediaRelay(OutcomeOpened)
	rl.serve(worker, id)
	return nil
}

// Join upgrades w into Twilio's socket for the relay the id names and hands
// it to that relay. Every refusal is the same 403, whatever the reason.
func (h *Hub) Join(w http.ResponseWriter, r *http.Request, id string) error {
	ctx := r.Context()
	refuse := func(outcome, reason string) error {
		h.metrics.RecordVoiceMediaRelay(outcome)
		h.logger.Debug("voice_media_relay_refused", zap.String("reason", reason), zap.String("relay", idPrefix(id)))
		return herr.New(ctx, domain.ErrVoiceRelayForbidden, herr.M{
			"message": "this relay id cannot be joined", "fault": "customer",
		})
	}
	claims, err := h.codec.Unseal(id, time.Now())
	switch {
	case errors.Is(err, ErrIDExpired):
		return refuse(OutcomeRefusedExpired, "expired")
	case err != nil:
		return refuse(OutcomeRefusedUnknown, "invalid")
	case claims.OwnerPodIP != "" && claims.OwnerPodIP != h.podIP:
		// Slice 2 hops to the owner; until then the id is not joinable here.
		h.logger.Info("relay_owner_remote", zap.String("relay", idPrefix(id)))
		return refuse(OutcomeRefusedUnknown, "owner_remote")
	}
	rl, outcome := h.claim(claims.Random)
	if rl == nil {
		return refuse(outcome, "not_pending")
	}
	twilio, err := websocket.Accept(w, r, acceptOptions())
	if err != nil {
		// The id is spent: leave the pending relay to end as lost.
		select {
		case rl.joined <- nil:
		case <-rl.done:
		}
		return nil
	}
	twilio.SetReadLimit(readLimit)
	select {
	case rl.joined <- twilio:
	case <-rl.done:
		// The relay ended between the claim and the upgrade: say why.
		code := rl.endedWith
		if code == 0 {
			code = ClosePeerLost
		}
		_ = twilio.Close(code, "relay_ended")
	}
	return nil
}

// acceptOptions: the id (or the worker's credential) authenticates the
// socket, so any origin may open one. No compression: media frames are small
// and already compressed.
func acceptOptions() *websocket.AcceptOptions {
	return &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled}
}

// admit takes a slot for a new pending relay and mints its sealed id.
func (h *Hub) admit(ctx context.Context, scope string) (*relay, string, error) {
	// The sealed expiry has one second resolution, so round up: the relay's own
	// pending timer is the exact clock, the id only has to outlive it.
	expiry := time.Now().Add(h.pendingTTL).Truncate(time.Second).Add(time.Second)
	claims := IDClaims{OwnerPodIP: h.podIP, OwnerBootID: h.bootID, ExpiresAt: expiry}
	if _, err := rand.Read(claims.Random[:]); err != nil {
		return nil, "", herr.New(ctx, domain.ErrInternal, herr.M{"fault": "gateway"})
	}
	id, err := h.codec.Seal(claims)
	if err != nil {
		return nil, "", herr.New(ctx, domain.ErrInternal, herr.M{
			"message": "the media relay cannot mint ids", "fault": "gateway",
		})
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	switch {
	case h.draining:
		return nil, "", relayUnavailable(ctx, "this gateway instance is shutting down and opens no new media relays: retry, and another instance will answer")
	case h.active >= h.maxRelays:
		return nil, "", relayUnavailable(ctx, "this gateway instance already holds its maximum number of media relays: retry shortly")
	case h.held[scope] >= h.maxRelaysPerScope:
		return nil, "", relayUnavailable(ctx, "this scope already holds its maximum number of media relays: retry shortly")
	case h.scopes[scope] >= h.maxPending:
		return nil, "", relayUnavailable(ctx, "too many media relays are waiting for Twilio: retry shortly")
	}
	rl := newRelay(h, scope, claims.Random)
	h.relays[claims.Random] = rl
	h.scopes[scope]++
	h.held[scope]++
	h.active++
	h.wg.Add(1)
	return rl, id, nil
}

func relayUnavailable(ctx context.Context, message string) error {
	return herr.New(ctx, domain.ErrVoiceRelayUnavailable, herr.M{"message": message, "fault": "gateway"})
}

// claim takes a pending relay for the Twilio socket that holds its id. It
// answers the outcome to count when there is none to take.
func (h *Hub) claim(random [16]byte) (*relay, string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	rl, ok := h.relays[random]
	switch {
	case !ok:
		return nil, OutcomeRefusedUnknown
	case rl.claimed:
		return nil, OutcomeRefusedReplay
	}
	rl.claimed = true
	h.scopes[rl.scope]--
	return rl, ""
}

// isClaimed reports whether a Twilio join has taken the relay.
func (h *Hub) isClaimed(rl *relay) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return rl.claimed
}

// release gives back a relay's slot. It is safe to call twice.
func (h *Hub) release(rl *relay) {
	rl.releaseOnce.Do(func() {
		h.mu.Lock()
		delete(h.relays, rl.random)
		h.active--
		if !rl.claimed {
			h.scopes[rl.scope]--
		}
		h.held[rl.scope]--
		if h.scopes[rl.scope] <= 0 {
			delete(h.scopes, rl.scope)
		}
		if h.held[rl.scope] <= 0 {
			delete(h.held, rl.scope)
		}
		h.mu.Unlock()
		close(rl.done)
		h.wg.Done()
	})
}

// idPrefix is as much of an id as may be logged.
func idPrefix(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}
