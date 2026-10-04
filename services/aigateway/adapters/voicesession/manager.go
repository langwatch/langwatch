package voicesession

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Why a supervised call ended. These are the values of the reason label.
const (
	ReasonVendorClosed   = "vendor_closed"
	ReasonBudgetExceeded = "budget_exceeded"
	ReasonKeyRevoked     = "key_revoked"
	ReasonSidebandLost   = "sideband_lost"
	ReasonDrain          = "drain"
	// ReasonSessionClosed means the control plane had already closed the
	// session, so nothing further could be recorded against it.
	ReasonSessionClosed = "session_closed"
)

// UsageRegistry records usage against a booked session.
type UsageRegistry interface {
	ReportUsage(ctx context.Context, report domain.RealtimeUsageReport) (domain.RealtimeUsageReceipt, error)
}

// BudgetCheck is the gateway's own budget precheck against a key's bundle.
type BudgetCheck func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetDecision, error)

// KeyReader re-reads a virtual key by id. An empty etag asks for the config
// outright, which is what refreshes the spend its budgets are judged on.
type KeyReader interface {
	ReadHeldKey(ctx context.Context, held *domain.Bundle, etag string) (domain.HeldKey, error)
}

// Metrics is what the supervisor reports to operators.
type Metrics interface {
	SetVoiceSessions(kind string, count int)
	RecordVoiceSessionEnded(kind, reason string)
	RecordVoiceUsageReport(outcome string)
}

// Timing holds every wait the supervisor makes. The zero value of a field
// takes its default; tests shrink them.
type Timing struct {
	// UsageInterval is the least time between two OpenAI Live duration reports.
	UsageInterval time.Duration
	// Tick is how often a call retries reports and runs its checks.
	Tick time.Duration
	// BudgetInterval is how often the budget precheck and the key state run.
	BudgetInterval time.Duration
	// KeyRefresh is how stale a key's bundle may get before it is re-read.
	KeyRefresh time.Duration
	// KeepAlive is how long a Live call may go without a recorded report.
	KeepAlive time.Duration
	// Backoff is the re-attach wait sequence; BackoffSteady follows it.
	Backoff       []time.Duration
	BackoffSteady time.Duration
	// ReattachWindow is how long a call may run with no server-side socket.
	ReattachWindow time.Duration
	// CloseWait is how long session.close may take before the hangup route.
	CloseWait time.Duration
	// HangupSettle is how long the socket is read after a hangup.
	HangupSettle time.Duration
	// CallTimeout bounds one dial, one hangup and one usage report.
	CallTimeout time.Duration
	// FinalAttempts and FinalBackoff bound the retries of a closing report.
	FinalAttempts int
	FinalBackoff  time.Duration
}

func (t Timing) withDefaults() Timing {
	set := func(d *time.Duration, def time.Duration) {
		if *d <= 0 {
			*d = def
		}
	}
	set(&t.UsageInterval, 10*time.Second)
	set(&t.Tick, 5*time.Second)
	set(&t.BudgetInterval, 30*time.Second)
	set(&t.KeyRefresh, 60*time.Second)
	set(&t.KeepAlive, 60*time.Second)
	set(&t.BackoffSteady, 10*time.Second)
	set(&t.ReattachWindow, 2*time.Minute)
	set(&t.CloseWait, 10*time.Second)
	set(&t.HangupSettle, 2*time.Second)
	set(&t.CallTimeout, 15*time.Second)
	set(&t.FinalBackoff, 2*time.Second)
	if len(t.Backoff) == 0 {
		t.Backoff = []time.Duration{time.Second, 2 * time.Second, 5 * time.Second}
	}
	if t.FinalAttempts <= 0 {
		t.FinalAttempts = 5
	}
	return t
}

// Options configures a Manager.
type Options struct {
	Registry UsageRegistry
	Vendor   *OpenAIVendor
	// Budget and Keys are optional. Without them a call ends on budget only
	// when a usage receipt says so, and never on a revoked key.
	Budget  BudgetCheck
	Keys    KeyReader
	Metrics Metrics
	Logger  *zap.Logger
	// RelayEndpoint resolves a relayed socket's path against the credential's
	// own host. Without it the relay routes refuse.
	RelayEndpoint EndpointFunc
	// MaxSessions caps the calls supervised at once. Zero means 2000.
	MaxSessions int
	// DrainBudget is how long calls may keep running after shutdown begins.
	DrainBudget time.Duration
	Timing      Timing
}

// Manager supervises every brokered call of this process: it admits them
// against a process-wide cap, tracks them, and ends them on shutdown.
type Manager struct {
	registry UsageRegistry
	vendor   *OpenAIVendor
	budget   BudgetCheck
	keys     KeyReader
	metrics  Metrics
	logger   *zap.Logger
	timing   Timing

	maxSessions   int
	drainBudget   time.Duration
	relayEndpoint EndpointFunc

	mu         sync.Mutex
	admitted   int
	sessions   map[*session]struct{}
	counts     map[domain.RealtimeSessionKind]int
	watches    map[string]*keyWatch
	draining   bool
	drainEnded bool
	drainTimer *time.Timer
	wg         sync.WaitGroup
}

// NewManager builds a Manager. It starts nothing until a call is handed over.
func NewManager(opts Options) *Manager {
	m := &Manager{
		registry:      opts.Registry,
		vendor:        opts.Vendor,
		budget:        opts.Budget,
		keys:          opts.Keys,
		metrics:       opts.Metrics,
		logger:        opts.Logger,
		timing:        opts.Timing.withDefaults(),
		maxSessions:   opts.MaxSessions,
		drainBudget:   opts.DrainBudget,
		relayEndpoint: opts.RelayEndpoint,
		sessions:      make(map[*session]struct{}),
		counts:        make(map[domain.RealtimeSessionKind]int),
		watches:       make(map[string]*keyWatch),
	}
	if m.maxSessions <= 0 {
		m.maxSessions = 2000
	}
	if m.logger == nil {
		m.logger = zap.NewNop()
	}
	if m.metrics == nil {
		m.metrics = discardMetrics{}
	}
	return m
}

// Admit takes a supervision slot, or refuses with ErrVoiceBrokerUnavailable
// when the gateway is draining or already supervises its maximum.
func (m *Manager) Admit(ctx context.Context, _ domain.RealtimeSessionKind) (domain.VoiceSlot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch {
	case m.draining:
		return nil, brokerUnavailable(ctx, "this gateway instance is shutting down and takes no new voice calls: retry, and another instance will answer")
	case m.admitted >= m.maxSessions:
		return nil, brokerUnavailable(ctx, "this gateway instance already supervises its maximum number of voice calls: retry shortly")
	}
	m.admitted++
	m.wg.Add(1)
	return &slot{manager: m}, nil
}

func brokerUnavailable(ctx context.Context, message string) error {
	return herr.New(ctx, domain.ErrVoiceBrokerUnavailable, herr.M{
		"message": message,
		"fault":   "gateway",
	})
}

// Supervised is how many slots are taken.
func (m *Manager) Supervised() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.admitted
}

func (m *Manager) String() string { return "voice-sessions" }

// Start makes the manager begin draining when ctx ends, which is the moment
// shutdown is signaled and before the listener stops.
func (m *Manager) Start(ctx context.Context) error {
	go func() {
		<-ctx.Done()
		m.BeginDrain()
	}()
	return nil
}

// BeginDrain refuses new calls and starts the drain clock. Calls still
// running when it expires are ended and their final reports sent.
func (m *Manager) BeginDrain() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.draining {
		return
	}
	m.draining = true
	m.logger.Info("voice_sessions_draining",
		zap.Int("supervised", m.admitted), zap.Duration("drain_budget", m.drainBudget))
	m.drainTimer = time.AfterFunc(m.drainBudget, m.endAll)
}

// endAll ends every supervised call for the drain.
func (m *Manager) endAll() {
	m.mu.Lock()
	m.drainEnded = true
	running := make([]*session, 0, len(m.sessions))
	for s := range m.sessions {
		running = append(running, s)
	}
	m.mu.Unlock()
	for _, s := range running {
		s.requestEnd(ReasonDrain)
	}
}

// stopAllowance is what ending the remaining calls may take once the drain
// budget has run out: the close wait, the hangup and the final reports.
const stopAllowance = 30 * time.Second

// StopBudget is the deadline Stop needs, which is longer than a request's.
func (m *Manager) StopBudget() time.Duration { return m.drainBudget + stopAllowance }

// Stop waits for every supervised call to end. The drain clock ends the ones
// still running, so a Stop that outlives it returns with nothing supervised.
func (m *Manager) Stop(ctx context.Context) error {
	m.BeginDrain()
	idle := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(idle)
	}()
	select {
	case <-idle:
		return nil
	case <-ctx.Done():
		m.endAll()
		return ctx.Err()
	}
}

// slot is one admitted place. Exactly one of its methods runs.
type slot struct {
	manager *Manager
	once    sync.Once
}

func (sl *slot) Release() {
	sl.once.Do(sl.manager.release)
}

func (m *Manager) release() {
	m.mu.Lock()
	m.admitted--
	m.mu.Unlock()
	m.wg.Done()
}

func (sl *slot) Abandon(ctx context.Context, call domain.BrokeredVoiceSession) {
	sl.once.Do(func() {
		m := sl.manager
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), m.timing.CallTimeout)
		defer cancel()
		if err := m.vendor.Hangup(ctx, call); err != nil {
			m.logger.Warn("voice_session_abandon_hangup_failed",
				zap.String("session_id", call.SessionID), zap.Error(err))
		}
		m.release()
	})
}

func (sl *slot) Start(call domain.BrokeredVoiceSession) {
	sl.once.Do(func() { sl.manager.start(call) })
}

func (m *Manager) start(call domain.BrokeredVoiceSession) {
	go m.track(call).run()
}

// track registers a call under the manager: counted, watched and reachable
// by the drain. Whoever takes it must end in finished.
func (m *Manager) track(call domain.BrokeredVoiceSession) *session {
	if call.StartedAt.IsZero() {
		call.StartedAt = time.Now()
	}
	s := &session{
		BrokeredVoiceSession: call,
		manager:              m,
		end:                  make(chan string, 1),
		seen:                 make(map[string]struct{}),
		lastReported:         call.StartedAt,
		lastChecked:          call.StartedAt,
	}
	m.mu.Lock()
	m.sessions[s] = struct{}{}
	m.counts[call.Kind]++
	count := m.counts[call.Kind]
	s.watch = m.watchLocked(call)
	ended := m.drainEnded
	m.mu.Unlock()
	m.metrics.SetVoiceSessions(string(call.Kind), count)
	if ended {
		s.requestEnd(ReasonDrain)
	}
	return s
}

// finished removes a call that ended and gives its slot back.
func (m *Manager) finished(s *session, reason string) {
	m.mu.Lock()
	delete(m.sessions, s)
	m.counts[s.Kind]--
	count := m.counts[s.Kind]
	m.unwatchLocked(s)
	m.mu.Unlock()
	m.metrics.SetVoiceSessions(string(s.Kind), count)
	m.metrics.RecordVoiceSessionEnded(string(s.Kind), reason)
	m.release()
}

type discardMetrics struct{}

func (discardMetrics) SetVoiceSessions(string, int)           {}
func (discardMetrics) RecordVoiceSessionEnded(string, string) {}
func (discardMetrics) RecordVoiceUsageReport(string)          {}
