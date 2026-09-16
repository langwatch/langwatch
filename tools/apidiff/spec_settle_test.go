package apidiff

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A proxy answers 502 for an upstream it cannot reach yet, so the settle must
// keep asking; the instance's own 404 is an answer, and must not be waited on.
//
// @scenario "A ready lane that is not serving yet is waited out, not failed"
func TestFetchSpecSettled(t *testing.T) {
	previous := specSettleInterval
	specSettleInterval = time.Millisecond
	t.Cleanup(func() { specSettleInterval = previous })

	t.Run("given a proxy answering 502 until the app serves", func(t *testing.T) {
		attempts := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			attempts++
			if attempts < 3 {
				writer.WriteHeader(http.StatusBadGateway)
				return
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"openapi":"3.0.3","paths":{}}`))
		}))
		t.Cleanup(server.Close)

		document, _, err := fetchSpecSettled(context.Background(), specFetch{client: server.Client(), baseURL: server.URL, settle: time.Minute, progress: io.Discard})
		if err != nil {
			t.Fatalf("settled fetch: %v", err)
		}
		if document["openapi"] != "3.0.3" {
			t.Fatalf("parsed the wrong document: %v", document)
		}
		if attempts != 3 {
			t.Fatalf("expected the settle to ask 3 times, asked %d", attempts)
		}
	})

	t.Run("given no settle window, as the probe subcommand is handed", func(t *testing.T) {
		attempts := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			attempts++
			writer.WriteHeader(http.StatusBadGateway)
		}))
		t.Cleanup(server.Close)

		if _, _, err := fetchSpecSettled(context.Background(), specFetch{client: server.Client(), baseURL: server.URL, progress: io.Discard}); err == nil {
			t.Fatal("expected a zero window to fail on the first attempt")
		}
		if attempts != 1 {
			t.Fatalf("expected one attempt with no settle window, got %d", attempts)
		}
	})

	t.Run("when the instance answers with a status of its own", func(t *testing.T) {
		attempts := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			attempts++
			writer.WriteHeader(http.StatusNotFound)
		}))
		t.Cleanup(server.Close)

		if _, _, err := fetchSpecSettled(context.Background(), specFetch{client: server.Client(), baseURL: server.URL, settle: time.Minute, progress: io.Discard}); err == nil {
			t.Fatal("expected a 404 to fail immediately")
		}
		if attempts != 1 {
			t.Fatalf("expected one attempt for an answered status, got %d", attempts)
		}
	})
}
