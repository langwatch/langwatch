package ingestionbench

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// collectorStub stands in for the app's /api/otel/v1/traces route.
func collectorStub(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/otel/v1/traces" {
			t.Errorf("driver posted to %q, want /api/otel/v1/traces", r.URL.Path)
		}
		if r.Header.Get("X-Auth-Token") == "" {
			t.Error("driver did not send the project api key")
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)
	return server
}

// clickhouseStub stands in for ClickHouse's HTTP interface, returning the
// given JSONEachRow body for every query.
func clickhouseStub(t *testing.T, body string) *chClient {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(server.Close)
	client, err := newCHClient(server.URL + "/bench")
	if err != nil {
		t.Fatalf("could not build ClickHouse client: %v", err)
	}
	return client
}

func preflightArgs(endpoint string) RunArgs {
	return RunArgs{
		Endpoint: endpoint,
		Seed:     1337,
		Tenants:  []Tenant{{ProjectID: "p1", APIKey: "sk-lw-a"}, {ProjectID: "p2", APIKey: "sk-lw-b"}},
	}
}

func TestPreflight(t *testing.T) {
	accepted := `{"message":"Trace received successfully.","partialSuccess":{"rejectedSpans":0,"errorMessage":""}}`

	t.Run("given the span is accepted and lands in ClickHouse", func(t *testing.T) {
		t.Run("passes so the stages can start", func(t *testing.T) {
			collector := collectorStub(t, http.StatusOK, accepted)
			ch := clickhouseStub(t, `{"TraceId":"abc","SpanCount":"1"}`+"\n")

			err := preflight(context.Background(), collector.Client(), ch,
				preflightArgs(collector.URL), 5*time.Second, io.Discard)
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	})

	t.Run("when the collector accepts the span but nothing ever folds it", func(t *testing.T) {
		// This is the no-worker misconfiguration: the GroupQueue consumer only
		// runs for processRole "worker"/"all", so a web-role process enqueues
		// into Redis and never drains.

		run := func(t *testing.T) error {
			t.Helper()
			collector := collectorStub(t, http.StatusOK, accepted)
			ch := clickhouseStub(t, "")
			return preflight(context.Background(), collector.Client(), ch,
				preflightArgs(collector.URL), 300*time.Millisecond, io.Discard)
		}

		t.Run("fails rather than proceeding into the stages", func(t *testing.T) {
			if err := run(t); err == nil {
				t.Fatal("expected preflight to fail when nothing drains")
			}
		})

		t.Run("reports it as a harness problem, not as lost spans", func(t *testing.T) {
			// The whole point: without this, the same misconfiguration shows up
			// as tens of thousands of "lost spans" and reads as a pipeline
			// regression.
			err := run(t)
			if !errors.Is(err, errNothingDraining) {
				t.Fatalf("got %v, want errNothingDraining", err)
			}
			if !strings.Contains(err.Error(), "harness problem") {
				t.Errorf("error does not frame itself as a harness problem: %v", err)
			}
		})

		t.Run("names the likely cause so the run is diagnosable from the log alone", func(t *testing.T) {
			err := run(t)
			for _, want := range []string{"worker", "GroupQueue", "start:workers"} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error does not mention %q: %v", want, err)
				}
			}
		})
	})

	t.Run("when the collector refuses the span", func(t *testing.T) {
		t.Run("fails without waiting on ClickHouse", func(t *testing.T) {
			collector := collectorStub(t, http.StatusUnauthorized, `{"message":"unauthorized"}`)
			ch := clickhouseStub(t, "")

			started := time.Now()
			err := preflight(context.Background(), collector.Client(), ch,
				preflightArgs(collector.URL), 10*time.Second, io.Discard)
			if err == nil {
				t.Fatal("expected preflight to fail on a rejected span")
			}
			if !strings.Contains(err.Error(), "rejected by the collector") {
				t.Errorf("got %v, want a collector-rejection error", err)
			}
			// It must not burn the ClickHouse wait on a span that was never
			// accepted in the first place.
			if elapsed := time.Since(started); elapsed > 5*time.Second {
				t.Errorf("took %s; should fail immediately", elapsed)
			}
		})
	})

	t.Run("when the receiver 2xxs but rejects the span in partialSuccess", func(t *testing.T) {
		t.Run("treats it as a refusal rather than waiting for a span that was never taken", func(t *testing.T) {
			partial := `{"partialSuccess":{"rejectedSpans":1,"errorMessage":"dropped"}}`
			collector := collectorStub(t, http.StatusOK, partial)
			ch := clickhouseStub(t, "")

			err := preflight(context.Background(), collector.Client(), ch,
				preflightArgs(collector.URL), 2*time.Second, io.Discard)
			if err == nil || !strings.Contains(err.Error(), "rejected by the collector") {
				t.Errorf("got %v, want a collector-rejection error", err)
			}
		})
	})
}
