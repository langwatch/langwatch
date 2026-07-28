package pipeline

import (
	"context"
	"errors"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
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

func unreachableControlPlane(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, errors.New("control plane unreachable")
}

func allowingPre(context.Context, *domain.Bundle, *domain.Request) (domain.GuardrailVerdict, error) {
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
}

func allowingPost(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
}

func failingPost(context.Context, *domain.Bundle, *domain.Request, *domain.Response) (domain.GuardrailVerdict, error) {
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, errors.New("control plane unreachable")
}

func allowingChunk(context.Context, *domain.Bundle, *domain.Request, []byte) (domain.GuardrailVerdict, error) {
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
}

func callWithGuardrail(requestFailOpen, responseFailOpen bool) *Call {
	return &Call{
		Bundle:  bundleWithGuardrail(requestFailOpen, responseFailOpen),
		Request: &domain.Request{Body: []byte(`{"messages":[]}`)},
	}
}

/** @scenario "the check endpoint being unreachable blocks by default" */
func TestGuardrailInterceptorFailsClosedOnEvaluationError(t *testing.T) {
	logger := zap.NewNop()

	// The request direction on a sync call. This is the path a plain
	// completion takes.
	t.Run("given a sync call whose request guardrail cannot be evaluated", func(t *testing.T) {
		dispatched := false
		handler := Guardrail(unreachableControlPlane, allowingPost, allowingChunk, logger).
			Sync(func(context.Context, *Call) (*domain.Response, error) {
				dispatched = true
				return &domain.Response{}, nil
			})

		_, err := handler(context.Background(), callWithGuardrail(false, false))
		if err == nil {
			t.Fatal("expected a fail-closed guardrail to stop the request")
		}
		if !herr.IsCode(err, domain.ErrGuardrailUpstreamUnavailable) {
			t.Fatalf("err = %v, want %v", err, domain.ErrGuardrailUpstreamUnavailable)
		}
		if dispatched {
			t.Fatal("the provider must not be called when a fail-closed guardrail cannot be evaluated")
		}
	})

	// The response direction has its own branch, and a provider call has
	// already happened by the time it runs. The response must not reach the
	// caller unchecked.
	t.Run("given a sync call whose response guardrail cannot be evaluated", func(t *testing.T) {
		handler := Guardrail(allowingPre, failingPost, allowingChunk, logger).
			Sync(func(context.Context, *Call) (*domain.Response, error) {
				return &domain.Response{}, nil
			})

		resp, err := handler(context.Background(), callWithGuardrail(false, false))
		if err == nil {
			t.Fatal("expected the unchecked response to be withheld")
		}
		if resp != nil {
			t.Fatal("the response must not be returned when its guardrail could not be evaluated")
		}
	})

	// Stream has its own fail-closed branch and is the one most likely to be
	// regressed back to allowing, because the failure is invisible until the
	// stream is already open.
	t.Run("given a streaming call whose request guardrail cannot be evaluated", func(t *testing.T) {
		opened := false
		stream := Guardrail(unreachableControlPlane, allowingPost, allowingChunk, logger).
			Stream(func(context.Context, *Call) (domain.StreamIterator, error) {
				opened = true
				return nil, nil
			})

		iter, err := stream(context.Background(), callWithGuardrail(false, false))
		if err == nil {
			t.Fatal("expected a fail-closed guardrail to stop the stream")
		}
		if iter != nil {
			t.Fatal("no iterator may be handed back when the guardrail could not be evaluated")
		}
		if opened {
			t.Fatal("the provider stream must not be opened when a fail-closed guardrail cannot be evaluated")
		}
	})
}

/** @scenario "a key that opted into fail-open passes traffic through" */
func TestGuardrailInterceptorFailsOpenWhenTheKeyOptedIn(t *testing.T) {
	logger := zap.NewNop()

	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	ctx, span := provider.Tracer("test").Start(context.Background(), "gateway.request")

	dispatched := false
	handler := Guardrail(unreachableControlPlane, allowingPost, allowingChunk, logger).
		Sync(func(context.Context, *Call) (*domain.Response, error) {
			dispatched = true
			return &domain.Response{}, nil
		})

	if _, err := handler(ctx, callWithGuardrail(true, true)); err != nil {
		t.Fatalf("expected a fail-open guardrail to let the request through, got %v", err)
	}
	if !dispatched {
		t.Fatal("the provider should have been called")
	}

	// Passing traffic through an unevaluated guardrail is a degradation, and
	// the request that skipped it is the one being traced. Without this the
	// bypass is invisible to whoever is looking at the trace.
	span.End()
	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("expected one span, got %d", len(spans))
	}
	var failOpen bool
	for _, attr := range spans[0].Attributes {
		if attr.Key == "langwatch.guardrail.fail_open" {
			failOpen = attr.Value.AsBool()
		}
	}
	if !failOpen {
		t.Errorf("the fail-open bypass was not recorded on the span: %+v", spans[0].Attributes)
	}
	var recorded bool
	for _, event := range spans[0].Events {
		if event.Name == "guardrail_fail_open" {
			recorded = true
		}
	}
	if !recorded {
		t.Errorf("expected a guardrail_fail_open event on the span, got %+v", spans[0].Events)
	}
}
