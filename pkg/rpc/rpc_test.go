package rpc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
)

func init() { RegisterStatuses() }

type body struct {
	Name string `json:"name" validate:"required"`
	Nest struct {
		Field string `json:"field" validate:"required"`
	} `json:"nest"`
}

type resp struct {
	Echo string `json:"echo"`
}

const maxBody = 1_000

func errType(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env struct {
		Error struct {
			Type string                    `json:"type"`
			Meta struct{ Fields []string } `json:"meta"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("not a herr envelope: %v (%q)", err, rec.Body.String())
	}
	return env.Error.Type
}

func TestDecode_Failures(t *testing.T) {
	t.Run("when the body is not valid JSON", func(t *testing.T) {
		h := HandleNoContent(maxBody, func(context.Context, *body) error { return nil })
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{not-json")))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		if got := errType(t, rec); got != string(CodeBadRequest) {
			t.Errorf("type = %q, want bad_request", got)
		}
	})

	t.Run("when a required field is missing", func(t *testing.T) {
		h := HandleNoContent(maxBody, func(context.Context, *body) error { return nil })
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"x"}`)))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400", rec.Code)
		}
		// The named field path rides in meta.fields for diagnostics.
		var env struct {
			Error struct {
				Meta struct {
					Fields []string `json:"fields"`
				} `json:"meta"`
			} `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &env)
		if len(env.Error.Meta.Fields) == 0 || env.Error.Meta.Fields[0] != "Nest.Field" {
			t.Errorf("want field Nest.Field named, got %v", env.Error.Meta.Fields)
		}
	})

	t.Run("when the body exceeds the cap", func(t *testing.T) {
		h := HandleNoContent(8, func(context.Context, *body) error { return nil })
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"aaaaaaaaaaaaaaaaaaaa"}`)))
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want 413", rec.Code)
		}
		if got := errType(t, rec); got != string(CodePayloadTooLarge) {
			t.Errorf("type = %q, want payload_too_large", got)
		}
	})
}

func TestHandle_Serialization(t *testing.T) {
	valid := `{"name":"x","nest":{"field":"y"}}`

	t.Run("when the verb returns a response", func(t *testing.T) {
		h := Handle(maxBody, func(_ context.Context, b *body) (*resp, error) {
			return &resp{Echo: b.Name}, nil
		})
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(valid)))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		var out resp
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if out.Echo != "x" {
			t.Errorf("echo = %q, want x", out.Echo)
		}
	})

	t.Run("when the verb returns a nil response", func(t *testing.T) {
		h := Handle(maxBody, func(context.Context, *body) (*resp, error) { return nil, nil })
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(valid)))
		if rec.Code != http.StatusNoContent {
			t.Errorf("status = %d, want 204", rec.Code)
		}
	})

	t.Run("when the verb returns a herr", func(t *testing.T) {
		h := Handle(maxBody, func(ctx context.Context, _ *body) (*resp, error) {
			return nil, herr.NewLight(ctx, CodeBadRequest, herr.M{"message": "nope"})
		})
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(valid)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", rec.Code)
		}
	})
}
