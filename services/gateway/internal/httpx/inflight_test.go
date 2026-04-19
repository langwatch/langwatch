package httpx

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

type fakeGauge struct {
	mu   sync.Mutex
	cur  int64
	peak int64
}

func (f *fakeGauge) Inc() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cur++
	if f.cur > f.peak {
		f.peak = f.cur
	}
}

func (f *fakeGauge) Dec() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cur--
}

func TestInFlightIncDecAroundHandler(t *testing.T) {
	g := &fakeGauge{}
	h := InFlight(g)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// When a handler is mid-flight the gauge must be positive.
		if g.cur < 1 {
			t.Errorf("in-handler: cur=%d want >= 1", g.cur)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	h.ServeHTTP(rec, req)
	if g.cur != 0 {
		t.Errorf("after exit: cur=%d want 0", g.cur)
	}
	if g.peak != 1 {
		t.Errorf("peak=%d want 1", g.peak)
	}
}

func TestInFlightDecsOnPanic(t *testing.T) {
	g := &fakeGauge{}
	h := InFlight(g)(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		panic("boom")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	func() {
		defer func() { _ = recover() }()
		h.ServeHTTP(rec, req)
	}()
	if g.cur != 0 {
		t.Errorf("after panic: cur=%d want 0 (deferred Dec must fire)", g.cur)
	}
}

func TestInFlightNilGaugeIsPassthrough(t *testing.T) {
	calls := atomic.Int32{}
	h := InFlight(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/v1/chat/completions", nil))
	if calls.Load() != 1 || rec.Code != http.StatusNoContent {
		t.Errorf("nil gauge should passthrough handler; calls=%d code=%d", calls.Load(), rec.Code)
	}
}
