package httpx

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

func echoHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			// Simulate dispatcher: distinguish MaxBytesError and map
			// it to the correct envelope.
			if IsMaxBytesError(err) {
				gwerrors.Write(w, "", gwerrors.TypePayloadTooLarge,
					"payload_too_large", err.Error(), "")
				return
			}
			gwerrors.Write(w, "", gwerrors.TypeBadRequest,
				"body_read_failed", err.Error(), "")
			return
		}
		_, _ = w.Write(b)
	})
}

func TestMaxBodyBytesPassthroughBelowLimit(t *testing.T) {
	h := MaxBodyBytes(1024)(echoHandler())
	rec := httptest.NewRecorder()
	body := bytes.Repeat([]byte("a"), 512)
	req := httptest.NewRequest("POST", "/v1/chat/completions", bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d want 200", rec.Code)
	}
	if rec.Body.Len() != 512 {
		t.Errorf("echoed body len=%d want 512", rec.Body.Len())
	}
}

func TestMaxBodyBytesRejectsDeclaredOversize(t *testing.T) {
	h := MaxBodyBytes(1024)(echoHandler())
	rec := httptest.NewRecorder()
	body := bytes.Repeat([]byte("a"), 2048)
	req := httptest.NewRequest("POST", "/v1/chat/completions", bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("code=%d want 413", rec.Code)
	}
	var env gwerrors.Envelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Type != gwerrors.TypePayloadTooLarge {
		t.Errorf("error.type=%q want payload_too_large", env.Error.Type)
	}
	if !strings.Contains(env.Error.Message, "maximum") {
		t.Errorf("error.message should explain cap, got %q", env.Error.Message)
	}
}

func TestMaxBodyBytesRejectsUndeclaredOversize(t *testing.T) {
	// Content-Length unset (streamed / chunked body) → ReadAll hits
	// MaxBytesReader mid-stream. Handler must still emit 413.
	h := MaxBodyBytes(1024)(echoHandler())
	rec := httptest.NewRecorder()
	body := bytes.Repeat([]byte("a"), 2048)
	req := httptest.NewRequest("POST", "/v1/chat/completions", bytes.NewReader(body))
	req.ContentLength = -1 // "unknown"
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("code=%d want 413", rec.Code)
	}
	var env gwerrors.Envelope
	_ = json.NewDecoder(rec.Body).Decode(&env)
	if env.Error.Type != gwerrors.TypePayloadTooLarge {
		t.Errorf("error.type=%q want payload_too_large", env.Error.Type)
	}
}

func TestMaxBodyBytesZeroLimitIsPassthrough(t *testing.T) {
	h := MaxBodyBytes(0)(echoHandler())
	rec := httptest.NewRecorder()
	body := bytes.Repeat([]byte("a"), 10_000)
	req := httptest.NewRequest("POST", "/v1/chat/completions", bytes.NewReader(body))
	req.ContentLength = int64(len(body))
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code=%d want 200 (passthrough)", rec.Code)
	}
}

func TestIsMaxBytesErrorClassifier(t *testing.T) {
	var mbe = &http.MaxBytesError{Limit: 10}
	if !IsMaxBytesError(mbe) {
		t.Error("*http.MaxBytesError should match")
	}
	if IsMaxBytesError(io.EOF) {
		t.Error("io.EOF should NOT match")
	}
	if IsMaxBytesError(nil) {
		t.Error("nil should NOT match")
	}
}
