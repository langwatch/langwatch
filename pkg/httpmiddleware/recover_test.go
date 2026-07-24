package httpmiddleware

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// testCtx returns a request context with a service-info value so the
// middleware's logging path doesn't blow up looking for it.
func testCtx() context.Context {
	return contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service:     "test",
		Version:     "test",
		Environment: "test",
	})
}

// TestRecover_GenericPanicReturns500AndRePanics — the historical
// happy-path: a generic panic should result in a 500 response to the
// client AND a re-panic so net/http closes the connection.
func TestRecover_GenericPanicReturns500AndRePanics(t *testing.T) {
	h := Recover()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(errors.New("boom"))
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(testCtx())
	defer func() {
		if v := recover(); v == nil {
			t.Fatalf("Recover middleware did not re-panic on a generic panic; net/http would not close the connection cleanly")
		}
	}()
	h.ServeHTTP(rec, req)
	// The recorder captured the 500 written before re-panic.
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 in response, got %d", rec.Code)
	}
}

// TestRecover_ErrAbortHandlerIsRePanickedWithoutWritingResponse pins
// the AWS-Lambda-deploy fix: when the inner handler panics with
// http.ErrAbortHandler (the standard sentinel ReverseProxy uses when
// upstream EOFs mid-body), the middleware MUST NOT write a 500 — the
// response writer is in an indeterminate state and the extra
// WriteHeader call surfaces as "superfluous response.WriteHeader" in
// the log, plus crashes the Rust-based Lambda Web Adapter which
// expects a clean stream.
//
// Re-panicking the sentinel without touching the response writer is
// the documented contract: net/http's serve loop catches
// ErrAbortHandler and closes the connection silently.
func TestRecover_ErrAbortHandlerIsRePanickedWithoutWritingResponse(t *testing.T) {
	h := Recover()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(http.ErrAbortHandler)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(testCtx())

	rePanicked := false
	func() {
		defer func() {
			if v := recover(); v != nil {
				rePanicked = true
				err, ok := v.(error)
				if !ok || !errors.Is(err, http.ErrAbortHandler) {
					t.Errorf("expected ErrAbortHandler re-panic, got %v", v)
				}
			}
		}()
		h.ServeHTTP(rec, req)
	}()

	if !rePanicked {
		t.Fatalf("Recover did not re-panic ErrAbortHandler; net/http would not handle abort correctly")
	}
	if rec.Code != http.StatusOK {
		// httptest.ResponseRecorder defaults to 200 if WriteHeader was
		// never called. If our middleware (incorrectly) wrote a 500
		// before re-panicking, we'd see 500 here.
		t.Errorf("expected response writer untouched (default 200), got %d — middleware wrote a response despite ErrAbortHandler", rec.Code)
	}
	// And no body should have been written.
	body, _ := io.ReadAll(rec.Body)
	if len(strings.TrimSpace(string(body))) != 0 {
		t.Errorf("expected empty response body on ErrAbortHandler, got %q", string(body))
	}
}
