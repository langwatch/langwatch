package llmsim

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestDelayInModelHoldsTheFirstByte(t *testing.T) {
	srv := newTestServer(t)
	started := time.Now()
	resp, body := post(t, srv.URL+"/v1/chat/completions",
		`{"model":"gpt-5-delay-300","messages":[{"role":"user","content":"hi"}]}`, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body %s", resp.StatusCode, body)
	}
	if elapsed := time.Since(started); elapsed < 300*time.Millisecond {
		t.Fatalf("answered after %s, want at least 300ms", elapsed)
	}
	if !strings.Contains(body, `"choices"`) {
		t.Fatalf("body is not a completion: %s", body)
	}
}

func TestDelayEndsWhenTheCallerHangsUp(t *testing.T) {
	srv := newTestServer(t)
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, srv.URL+"/v1/chat/completions",
		strings.NewReader(`{"model":"gpt-5-delay-60000","messages":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
		t.Fatalf("got status %d, want the hang-up to end the call", resp.StatusCode)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want a deadline", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(readCalls(t, srv.URL), `"status":499`) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the console never recorded the hung-up call as 499")
}

func readCalls(t *testing.T, base string) string {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, base+"/_sim/api/calls", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}
