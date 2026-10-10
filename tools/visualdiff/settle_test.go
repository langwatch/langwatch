package visualdiff

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// @scenario A run waits for both stacks to answer before it captures anything
func TestWaitForListenersPollsUntilEachAnswers(t *testing.T) {
	var attempts atomic.Int32
	probe := func(_ context.Context, url string) bool {
		return attempts.Add(1) >= 3
	}
	var ready []string

	err := WaitForListeners(context.Background(), []string{"http://a", "http://b"}, WaitOptions{
		Timeout: 5 * time.Second, Probe: probe, Progress: func(url string) { ready = append(ready, url) },
	})

	if err != nil {
		t.Fatal(err)
	}
	if len(ready) != 2 {
		t.Fatalf("both listeners should be reported ready: %v", ready)
	}
	if attempts.Load() < 3 {
		t.Fatalf("the probe was not retried: %d attempts", attempts.Load())
	}
}

// @scenario A run waits for both stacks to answer before it captures anything
func TestWaitForListenersFailsAtTheBootTimeout(t *testing.T) {
	never := func(context.Context, string) bool { return false }

	err := WaitForListeners(context.Background(), []string{"http://never"}, WaitOptions{
		Timeout: 10 * time.Millisecond, Probe: never,
	})

	if err == nil {
		t.Fatal("a listener that never answers was reported ready")
	}
	mustContain(t, err.Error(), "http://never")
}

func TestHTTPProbeAcceptsAnythingBelowServerError(t *testing.T) {
	notFound := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer notFound.Close()
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer broken.Close()

	if !HTTPProbe(context.Background(), notFound.URL) {
		t.Fatal("a 404 still proves the listener is up")
	}
	if HTTPProbe(context.Background(), broken.URL) {
		t.Fatal("a stack that boots into a 500 is not ready to be photographed")
	}
}

func TestPortListeningSeesAServerAndItsAbsence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	address, ok := server.Listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatal("the test server is not on TCP")
	}

	if !PortListening(address.Port) {
		t.Fatalf("port %d holds a server but was reported free", address.Port)
	}
	server.Close()
	if PortListening(address.Port) {
		t.Fatalf("port %d was reported held after the server closed", address.Port)
	}
}
