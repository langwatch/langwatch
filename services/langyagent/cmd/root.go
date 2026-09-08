// Package cmd exposes the langyagent service entrypoint for the mono-binary
// (cmd/service). Mirrors the aigateway / nlpgo pattern: LoadConfig → NewDeps →
// wire adapters → Serve.
package cmd

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/contexts"
	langyagent "github.com/langwatch/langwatch/services/langyagent"
	"github.com/langwatch/langwatch/services/langyagent/adapters/controlplane"
	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/sandboxed"
	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/sharedidentity"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/app/workerpool"
)

// Root is the service entrypoint called by cmd/service. Errors returned here
// cause `service langyagent` to exit non-zero — missing LANGY_INTERNAL_SECRET,
// an unparseable PORT, etc. fail fast at container start rather than at first
// traffic.
func Root(ctx context.Context, _ []string) error {
	cfg, err := langyagent.LoadConfig(ctx)
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-langyagent"
	info.Environment = cfg.Environment
	ctx = contexts.SetServiceInfo(ctx, *info)

	ctx, deps, err := langyagent.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}

	// The egress guard (ADR-076): per-worker outbound forward-proxy enforcement
	// (require-TLS / throttle / floor ∪ allow-list / SNI cross-check), monitor-
	// first for *destination* decisions: the floor ∪ allow-list verdict only
	// observes and flags until an operator/customer opts in. Require-TLS is a
	// separate, always-on rung — EgressRequireTLS defaults to true, so cleartext
	// forwards and non-:443 CONNECTs are refused with no opt-in.
	// The pool consults it around each worker's lifecycle behind this seam.
	mgr := startEgressAdapter(cfg, deps.Logger)

	// The isolation substrate (ADR-033). Per-uid is the default: the sandboxed
	// runner chowns each worker's home and setuids the subprocess into its own
	// uid, which is what stops one conversation's worker reading another's.
	//
	// The operator can trade that away (ADR-130) for a pod that needs neither
	// root nor any capability, because a cluster enforcing non-root admits no
	// other shape. LoadConfig has already refused anything but these two
	// values, so there is no third case to fail closed on here.
	//
	// The WARN is unconditional for the weaker posture and says what is
	// actually exposed rather than that something is "unsafe": it belongs in
	// the first support bundle, not reconstructed from a values file after an
	// incident.
	var runner app.Runner = sandboxed.New()
	if cfg.WorkerIsolation == langyagent.WorkerIsolationNone {
		runner = sharedidentity.New()
		deps.Logger.Warn(
			"per-worker identity isolation is OFF: one conversation's worker can read another's live credentials from /proc/<pid>/environ and its conversation content from the session directory",
			zap.String("worker_isolation", cfg.WorkerIsolation),
		)
	}

	// The worker pool is the driven adapter. It wipes SESSIONS_ROOT before
	// accepting traffic and binds worker subprocesses to the pool-lifetime
	// context. The egress guard is consulted around each worker's lifecycle.
	pool, err := workerpool.New(ctx, workerpool.Options{
		MaxWorkers:       cfg.MaxWorkers,
		WorkerIdle:       cfg.WorkerIdle(),
		ReadinessTimeout: cfg.ReadinessTimeout(),
		ReaperInterval:   cfg.ReaperInterval(),
		SessionsRoot:     cfg.SessionsRoot,
		WorkspaceRoot:    cfg.WorkspaceRoot,
		PiBinaryPath:     cfg.PiWorkerBinaryPath,
		Runner:           runner,
		Telemetry:        deps.Telemetry,
		Egress:           mgr.EgressGuard(),
		// Revoke-only. The manager can destroy a session key it was handed; it can
		// never ask for one to be minted. It reuses the SAME shared secret the
		// control plane authenticates to us with, so this direction adds no new
		// credential and no new configuration to drift.
		Revoker: controlplane.NewRevoker(cfg.InternalSecret, 0),
		// Host-mediated worker telemetry + LLM traffic: workers export OTLP to
		// this loopback relay keyless and route LLM calls through it; the manager
		// injects the session key / virtual key on the forwards.
		OTelRelay: deps.OTelRelay,
	})
	if err != nil {
		return err
	}

	application := app.New(
		app.WithWorkerPool(pool),
		app.WithTelemetry(deps.Telemetry),
		// Durable-final poster: same shared secret as the Revoker, no new config.
		// The independent completion path back to langy-internal, retried and
		// idempotent on turnId.
		app.WithFinalizer(controlplane.NewFinalizer(cfg.InternalSecret, 0)),
		// Relay push: the live edge. The manager SIGNS each output frame with the
		// turn's runToken and streams it to the control-plane relay — same shared
		// secret, no new config. Disabled per-turn when no runToken rides the turn.
		app.WithFrameRelay(controlplane.NewRelayClient(cfg.InternalSecret)),
	)

	return langyagent.Serve(ctx, application, deps, cfg)
}
