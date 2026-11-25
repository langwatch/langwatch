package voicesession

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	providerKey = "sk-provider-secret"
	virtualKey  = "vk-lw-secret"
)

// fakeVendor is OpenAI's side of a brokered call: the server-side socket of
// both families and their hangup routes.
type fakeVendor struct {
	t      *testing.T
	server *httptest.Server

	mu          sync.Mutex
	conns       []*websocket.Conn
	attachAuth  []string
	attachPaths []string
	hangups     []string
	hangupAuth  []string
	received    []string
	// refuseAttach answers every attach with this status when set.
	refuseAttach int
	attached     chan *websocket.Conn
	gotMessage   chan string
	gotHangup    chan string
}

func newFakeVendor(t *testing.T) *fakeVendor {
	t.Helper()
	v := &fakeVendor{
		t:          t,
		attached:   make(chan *websocket.Conn, 16),
		gotMessage: make(chan string, 16),
		gotHangup:  make(chan string, 16),
	}
	v.server = httptest.NewServer(http.HandlerFunc(v.serve))
	t.Cleanup(v.server.Close)
	return v
}

func (v *fakeVendor) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/hangup") {
		v.mu.Lock()
		v.hangups = append(v.hangups, r.URL.Path)
		v.hangupAuth = append(v.hangupAuth, r.Header.Get("Authorization"))
		v.mu.Unlock()
		v.gotHangup <- r.URL.Path
		w.WriteHeader(http.StatusOK)
		return
	}
	v.mu.Lock()
	refuse := v.refuseAttach
	v.attachAuth = append(v.attachAuth, r.Header.Get("Authorization"))
	v.attachPaths = append(v.attachPaths, r.URL.RequestURI())
	v.mu.Unlock()
	if refuse != 0 {
		w.WriteHeader(refuse)
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	v.mu.Lock()
	v.conns = append(v.conns, conn)
	v.mu.Unlock()
	v.attached <- conn
	for {
		_, message, err := conn.Read(context.Background())
		if err != nil {
			return
		}
		v.mu.Lock()
		v.received = append(v.received, string(message))
		v.mu.Unlock()
		v.gotMessage <- string(message)
	}
}

// awaitAttach waits for the supervisor to attach and answers its socket.
func (v *fakeVendor) awaitAttach() *websocket.Conn {
	v.t.Helper()
	select {
	case conn := <-v.attached:
		return conn
	case <-time.After(5 * time.Second):
		v.t.Fatal("the supervisor never attached its server-side socket")
		return nil
	}
}

func (v *fakeVendor) send(conn *websocket.Conn, frame string) {
	v.t.Helper()
	require.NoError(v.t, conn.Write(context.Background(), websocket.MessageText, []byte(frame)))
}

func (v *fakeVendor) awaitMessage() string {
	v.t.Helper()
	select {
	case message := <-v.gotMessage:
		return message
	case <-time.After(5 * time.Second):
		v.t.Fatal("the vendor received nothing on the server-side socket")
		return ""
	}
}

func (v *fakeVendor) awaitHangup() string {
	v.t.Helper()
	select {
	case path := <-v.gotHangup:
		return path
	case <-time.After(5 * time.Second):
		v.t.Fatal("the hangup route was never called")
		return ""
	}
}

func (v *fakeVendor) attachCount() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return len(v.attachPaths)
}

func (v *fakeVendor) hangupCount() int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return len(v.hangups)
}

// fakeRegistry is the control plane's usage route.
type fakeRegistry struct {
	mu      sync.Mutex
	reports []domain.RealtimeUsageReport
	// failures is how many of the next reports fail.
	failures int
	// receipt answers a recorded report, by its position.
	receipt func(n int, report domain.RealtimeUsageReport) domain.RealtimeUsageReceipt
	changed chan struct{}
}

func newFakeRegistry() *fakeRegistry {
	return &fakeRegistry{changed: make(chan struct{}, 256)}
}

func (f *fakeRegistry) ReportUsage(_ context.Context, report domain.RealtimeUsageReport) (domain.RealtimeUsageReceipt, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failures > 0 {
		f.failures--
		return domain.RealtimeUsageReceipt{}, errors.New("control plane unreachable")
	}
	if report.Usage != nil {
		usage := *report.Usage
		report.Usage = &usage
	}
	f.reports = append(f.reports, report)
	select {
	case f.changed <- struct{}{}:
	default:
	}
	if f.receipt != nil {
		return f.receipt(len(f.reports), report), nil
	}
	return domain.RealtimeUsageReceipt{Status: domain.RealtimeReportRecorded}, nil
}

func (f *fakeRegistry) snapshot() []domain.RealtimeUsageReport {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]domain.RealtimeUsageReport(nil), f.reports...)
}

// awaitReports waits until n reports were recorded and answers them.
func (f *fakeRegistry) awaitReports(t *testing.T, n int) []domain.RealtimeUsageReport {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		if reports := f.snapshot(); len(reports) >= n {
			return reports
		}
		select {
		case <-f.changed:
		case <-time.After(10 * time.Millisecond):
		case <-deadline:
			t.Fatalf("expected %d usage reports, got %d: %+v", n, len(f.snapshot()), f.snapshot())
		}
	}
}

// fakeMetrics records what the supervisor told operators.
type fakeMetrics struct {
	mu      sync.Mutex
	ended   []string
	gauges  map[string]int
	reports map[string]int
	done    chan string
}

func newFakeMetrics() *fakeMetrics {
	return &fakeMetrics{gauges: map[string]int{}, reports: map[string]int{}, done: make(chan string, 16)}
}

func (f *fakeMetrics) SetVoiceSessions(kind string, count int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gauges[kind] = count
}

func (f *fakeMetrics) RecordVoiceSessionEnded(kind, reason string) {
	f.mu.Lock()
	f.ended = append(f.ended, kind+":"+reason)
	f.mu.Unlock()
	f.done <- reason
}

func (f *fakeMetrics) RecordVoiceUsageReport(outcome string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reports[outcome]++
}

func (f *fakeMetrics) awaitEnded(t *testing.T) string {
	t.Helper()
	select {
	case reason := <-f.done:
		return reason
	case <-time.After(5 * time.Second):
		t.Fatal("the supervised call never ended")
		return ""
	}
}

// fastTiming shrinks every wait so a test runs in milliseconds.
func fastTiming() Timing {
	return Timing{
		UsageInterval:  time.Millisecond,
		Tick:           10 * time.Millisecond,
		BudgetInterval: 20 * time.Millisecond,
		KeyRefresh:     20 * time.Millisecond,
		KeepAlive:      time.Hour,
		Backoff:        []time.Duration{5 * time.Millisecond},
		BackoffSteady:  5 * time.Millisecond,
		ReattachWindow: 2 * time.Second,
		CloseWait:      time.Second,
		HangupSettle:   100 * time.Millisecond,
		CallTimeout:    2 * time.Second,
		FinalAttempts:  3,
		FinalBackoff:   5 * time.Millisecond,
	}
}

// rig is one supervisor wired to a fake vendor and a fake control plane.
type rig struct {
	t        *testing.T
	vendor   *fakeVendor
	registry *fakeRegistry
	metrics  *fakeMetrics
	manager  *Manager
}

func newRig(t *testing.T, configure func(*Options)) *rig {
	t.Helper()
	r := &rig{t: t, vendor: newFakeVendor(t), registry: newFakeRegistry(), metrics: newFakeMetrics()}
	opts := Options{
		Registry: r.registry,
		Vendor: NewOpenAIVendor(r.vendor.server.Client(), func(cred domain.Credential, path string) string {
			return cred.Extra["base_url"] + path
		}),
		Metrics:     r.metrics,
		DrainBudget: time.Hour,
		Timing:      fastTiming(),
	}
	if configure != nil {
		configure(&opts)
	}
	r.manager = NewManager(opts)
	return r
}

func (r *rig) call(kind domain.RealtimeSessionKind, vendorID string) domain.BrokeredVoiceSession {
	return domain.BrokeredVoiceSession{
		SessionID:       "req_1",
		Kind:            kind,
		VendorSessionID: vendorID,
		Credential: domain.Credential{
			ID:         "openai_1",
			ProviderID: domain.ProviderOpenAI,
			APIKey:     providerKey,
			Extra:      map[string]string{"base_url": r.vendor.server.URL},
		},
		Bundle:    &domain.Bundle{VirtualKeyID: "vk_1", ProjectID: "proj_1"},
		StartedAt: time.Now(),
	}
}

// start admits one call and hands it to the supervisor.
func (r *rig) start(call domain.BrokeredVoiceSession) {
	r.t.Helper()
	slot, err := r.manager.Admit(context.Background(), call.Kind)
	require.NoError(r.t, err)
	slot.Start(call)
}

func (r *rig) live() domain.BrokeredVoiceSession {
	return r.call(domain.RealtimeKindLive, "live_123")
}

func (r *rig) realtime() domain.BrokeredVoiceSession {
	return r.call(domain.RealtimeKindRealtime, "rtc_456")
}
