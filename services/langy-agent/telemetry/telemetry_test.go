package telemetry

import (
	"context"
	"testing"
	"time"
)

// With no MeterProvider installed the instruments are no-ops, but every call
// site must be safe to invoke (this is the ADR-047 seam PR4 lights up). A panic
// here means a nil instrument slipped through New's fallback.
func TestTelemetry_AllCallSitesSafeWithoutProvider(t *testing.T) {
	tel := New()
	ctx := context.Background()

	c, end := tel.StartTurn(ctx, "conv-1")
	_ = c
	end.End()

	c2, span := tel.StartSpawn(ctx, "conv-1")
	_ = c2
	span.End()

	tel.TurnObserved(ctx, (250 * time.Millisecond).Seconds(), "ok")
	tel.AtCapacity(ctx)
	tel.WorkerSpawned(ctx, 1.5, true)
	tel.WorkerSpawned(ctx, 0.2, false)
	tel.ReadinessObserved(ctx, 3.0, true)
	tel.ReadinessObserved(ctx, 5.0, false)
	tel.WorkerKilled(ctx, "idle timeout")
}
