package pipeline

import (
	"context"
	"errors"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// A guardrail that cannot be evaluated is not a guardrail that passed. Before
// this, every evaluation error was logged and the request proceeded, so a
// control plane outage silently disabled every guardrail an operator had
// switched on while the UI kept showing them as active.

func bundleWithGuardrail(requestFailOpen, responseFailOpen bool) *domain.Bundle {
	return &domain.Bundle{
		Config: domain.BundleConfig{
			Guardrails: domain.GuardrailsConfig{
				Pre:              []domain.GuardrailEntry{{ID: "guard_1", Evaluator: "pii"}},
				Post:             []domain.GuardrailEntry{{ID: "guard_2", Evaluator: "pii"}},
				RequestFailOpen:  requestFailOpen,
				ResponseFailOpen: responseFailOpen,
			},
		},
	}
}

func TestGuardrailOutcome(t *testing.T) {
	logger := zap.NewNop()
	ctx := context.Background()

	t.Run("given the guardrail could not be evaluated", func(t *testing.T) {
		t.Run("when the key has not opted into fail-open, the request stops", func(t *testing.T) {
			err := guardrailOutcome(ctx, guardrailOutcomeInput{
				direction: "request",
				err:       errors.New("control plane unreachable"),
				failOpen:  false,
				logger:    logger,
			})
			if err == nil {
				t.Fatal("expected the request to be stopped, got nil")
			}
			if !herr.IsCode(err, domain.ErrGuardrailUpstreamUnavailable) {
				t.Fatalf("err = %v, want %v", err, domain.ErrGuardrailUpstreamUnavailable)
			}
		})

		t.Run("when the key opted into fail-open, the request proceeds", func(t *testing.T) {
			err := guardrailOutcome(ctx, guardrailOutcomeInput{
				direction: "request",
				err:       errors.New("control plane unreachable"),
				failOpen:  true,
				logger:    logger,
			})
			if err != nil {
				t.Fatalf("expected the request to proceed, got %v", err)
			}
		})
	})

	t.Run("given a verdict was returned", func(t *testing.T) {
		t.Run("when it blocks, the request stops with guardrail_blocked", func(t *testing.T) {
			err := guardrailOutcome(ctx, guardrailOutcomeInput{
				direction: "request",
				verdict:   domain.GuardrailVerdict{Action: domain.GuardrailBlock, Message: "PII detected"},
				logger:    logger,
			})
			if err == nil {
				t.Fatal("expected the request to be blocked, got nil")
			}
			if !herr.IsCode(err, domain.ErrGuardrailBlocked) {
				t.Fatalf("err = %v, want %v", err, domain.ErrGuardrailBlocked)
			}
		})

		t.Run("when it allows, the request proceeds", func(t *testing.T) {
			err := guardrailOutcome(ctx, guardrailOutcomeInput{
				direction: "request",
				verdict:   domain.GuardrailVerdict{Action: domain.GuardrailAllow},
				logger:    logger,
			})
			if err != nil {
				t.Fatalf("expected the request to proceed, got %v", err)
			}
		})
	})
}

func TestGuardrailInterceptorFailsClosedOnEvaluationError(t *testing.T) {
	logger := zap.NewNop()
	failing := func(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, errors.New("control plane unreachable")
	}
	post := func(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
	}
	chunk := func(context.Context, *domain.Bundle, *domain.Request, []byte) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
	}

	dispatched := false
	interceptor := Guardrail(failing, post, chunk, logger)
	handler := interceptor.Sync(func(context.Context, *Call) (*domain.Response, error) {
		dispatched = true
		return &domain.Response{}, nil
	})

	call := &Call{
		Bundle:  bundleWithGuardrail(false, false),
		Request: &domain.Request{Body: []byte(`{"messages":[]}`)},
	}
	_, err := handler(context.Background(), call)
	if err == nil {
		t.Fatal("expected a fail-closed guardrail to stop the request")
	}
	if dispatched {
		t.Fatal("the provider must not be called when a fail-closed guardrail cannot be evaluated")
	}
}

func TestGuardrailInterceptorFailsOpenWhenTheKeyOptedIn(t *testing.T) {
	logger := zap.NewNop()
	failing := func(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, errors.New("control plane unreachable")
	}
	post := func(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
	}
	chunk := func(context.Context, *domain.Bundle, *domain.Request, []byte) (domain.GuardrailVerdict, error) {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
	}

	dispatched := false
	interceptor := Guardrail(failing, post, chunk, logger)
	handler := interceptor.Sync(func(context.Context, *Call) (*domain.Response, error) {
		dispatched = true
		return &domain.Response{}, nil
	})

	call := &Call{
		Bundle:  bundleWithGuardrail(true, true),
		Request: &domain.Request{Body: []byte(`{"messages":[]}`)},
	}
	if _, err := handler(context.Background(), call); err != nil {
		t.Fatalf("expected a fail-open guardrail to let the request through, got %v", err)
	}
	if !dispatched {
		t.Fatal("the provider should have been called")
	}
}
