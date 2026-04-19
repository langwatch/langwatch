package gwerrors

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPStatusMapping(t *testing.T) {
	cases := map[Type]int{
		TypeInvalidAPIKey:        http.StatusUnauthorized,
		TypeVirtualKeyRevoked:    http.StatusUnauthorized,
		TypeBudgetExceeded:       http.StatusPaymentRequired,
		TypeGuardrailBlocked:     http.StatusForbidden,
		TypeModelNotAllowed:      http.StatusForbidden,
		TypeToolNotAllowed:       http.StatusForbidden,
		TypeURLNotAllowed:        http.StatusForbidden,
		TypeRateLimitExceeded:    http.StatusTooManyRequests,
		TypeUpstreamTimeout:      http.StatusGatewayTimeout,
		TypeProviderError:        http.StatusBadGateway,
		TypeCacheOverrideInvalid: http.StatusBadRequest,
		TypeBadRequest:           http.StatusBadRequest,
		TypeServiceUnavailable:   http.StatusServiceUnavailable,
		TypeInternalError:        http.StatusInternalServerError,
	}
	for typ, want := range cases {
		if got := typ.HTTPStatus(); got != want {
			t.Errorf("%s: got %d want %d", typ, got, want)
		}
	}
}

func TestWriteEchoesRequestIdAndEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	Write(rec, "req_abc", TypeBudgetExceeded, "budget_hard_cap_hit", "monthly project budget $50 reached", "")
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status: %d", rec.Code)
	}
	if got := rec.Header().Get("X-LangWatch-Request-Id"); got != "req_abc" {
		t.Fatalf("request id header: %q", got)
	}
	var env Envelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Error.Type != TypeBudgetExceeded {
		t.Errorf("type: %s", env.Error.Type)
	}
	if env.Error.Code != "budget_hard_cap_hit" {
		t.Errorf("code: %s", env.Error.Code)
	}
}
