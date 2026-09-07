package otellgtm

import (
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The bundle has run Pyroscope for several releases and provisions a datasource
// over it, but haven published only Grafana and the two OTLP ports — so the
// profiler was running, queryable from inside the container, and unreachable
// from any process on the host that wanted to push it a profile.
//
// @scenario "The observability stack exposes its profiling endpoint"
func TestRunArgsPublishesTheProfilingPort(t *testing.T) {
	endpoints := domain.DefaultObservabilityEndpoints()
	args := New(nil, t.TempDir(), "", endpoints, domain.DefaultObservabilityLimits(8<<30, 4)).runArgs(nil)

	want := "127.0.0.1:4040:4040"
	if !containsArg(args, want) {
		t.Fatalf("run args must publish the Pyroscope port as %q; got:\n%s", want, strings.Join(args, " "))
	}
}

// LW_OBS_PYROSCOPE_PORT=0 reads as "off" everywhere else: profilingUnready
// skips its probe and the worktree overlay names no endpoint. Docker does not
// read it that way — `127.0.0.1:0:4040` means "choose a host port for me", so
// publishing it regardless would leave the profiler reachable on a port nothing
// was told about while haven reported profiling disabled.
//
// @scenario "The observability stack exposes its profiling endpoint"
func TestRunArgsPublishesNoProfilingPortWhenDisabled(t *testing.T) {
	endpoints := domain.DefaultObservabilityEndpoints()
	endpoints.PyroscopePort = 0
	args := New(nil, t.TempDir(), "", endpoints, domain.DefaultObservabilityLimits(8<<30, 4)).runArgs(nil)

	for i, arg := range args {
		if arg != "-p" || i+1 >= len(args) {
			continue
		}
		if strings.HasSuffix(args[i+1], ":4040") {
			t.Errorf("a disabled profiler must publish no port, got %q", args[i+1])
		}
	}
}

// Anonymous access to this Grafana is Admin and Pyroscope has no auth at all, so
// the profiling port is bound to loopback for the same reason as every other
// port the stack publishes: on 0.0.0.0 it is the whole machine's business.
//
// @scenario "The observability stack exposes its profiling endpoint"
func TestRunArgsBindsEveryPublishedPortToLoopback(t *testing.T) {
	endpoints := domain.DefaultObservabilityEndpoints()
	args := New(nil, t.TempDir(), "", endpoints, domain.DefaultObservabilityLimits(8<<30, 4)).runArgs(nil)

	for i, arg := range args {
		if arg != "-p" || i+1 >= len(args) {
			continue
		}
		if published := args[i+1]; !strings.HasPrefix(published, "127.0.0.1:") {
			t.Errorf("published port %q is not bound to loopback", published)
		}
	}
}

// The failure this exists to catch is not "Pyroscope is down". It is Pyroscope
// serving happily with a stopped metastore: /ingest answers 200, so pushes look
// fine, while every read times out and the flame graph is empty. Observed on a
// container up four days. The reason string is what separates "it just started"
// from "recreate the container", so it has to reach the status line.
//
// @scenario "The observability stack exposes its profiling endpoint"
func TestProfilingUnreadyReportsTheReasonPyroscopeGives(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte("Metastore not ready: terminated after 50 retries\n"))
	}))
	defer srv.Close()

	got := stackProbing(t, srv.URL).profilingUnready(t.Context())

	if want := "Metastore not ready: terminated after 50 retries"; got != want {
		t.Errorf("profilingUnready() = %q, want %q", got, want)
	}
}

// @scenario "The observability stack exposes its profiling endpoint"
func TestProfilingUnreadyIsSilentWhenPyroscopeIsReady(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ready"))
	}))
	defer srv.Close()

	if got := stackProbing(t, srv.URL).profilingUnready(t.Context()); got != "" {
		t.Errorf("a ready Pyroscope must add nothing to the status line; got %q", got)
	}
}

// @scenario "The observability stack exposes its profiling endpoint"
func TestProfilingUnreadyReportsAnUnreachablePyroscope(t *testing.T) {
	// A port nothing listens on: the stack is up but Pyroscope is not.
	got := stackProbing(t, "http://127.0.0.1:1").profilingUnready(t.Context())

	if !strings.Contains(got, "not answering") {
		t.Errorf("profilingUnready() = %q, want it to say Pyroscope is not answering", got)
	}
}

// stackProbing builds a Stack whose Pyroscope endpoint is the given test server.
func stackProbing(t *testing.T, serverURL string) *Stack {
	t.Helper()
	port := 0
	if _, portText, err := net.SplitHostPort(strings.TrimPrefix(serverURL, "http://")); err == nil {
		port, _ = strconv.Atoi(portText)
	}
	endpoints := domain.DefaultObservabilityEndpoints()
	endpoints.PyroscopePort = port
	return New(nil, t.TempDir(), "", endpoints, domain.DefaultObservabilityLimits(8<<30, 4))
}

func containsArg(args []string, want string) bool {
	return slices.Contains(args, want)
}
