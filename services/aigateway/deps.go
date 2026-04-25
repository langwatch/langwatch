package aigateway

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/jwtverify"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/aigateway/adapters/authresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/budget"
	"github.com/langwatch/langwatch/services/aigateway/adapters/cacherules"
	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
	"github.com/langwatch/langwatch/services/aigateway/adapters/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/policy"
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
	"github.com/langwatch/langwatch/services/aigateway/adapters/ratelimit"
)

// Deps holds validated infrastructure adapters needed by the gateway.
type Deps struct {
	Logger        *zap.Logger
	NodeID        string
	OTel          *otelsetup.Provider
	TraceBridge   *customertracebridge.Emitter
	TraceRegistry *customertracebridge.Registry
	ControlPlane  *controlplane.Client
	Auth          *authresolver.Service
	Providers     *providers.BifrostRouter
	RateLimiter   *ratelimit.Limiter
	BudgetOutbox  *budget.Outbox
	BudgetChecker *budget.Checker
	Policy        *policy.Matcher
	Cache         *cacherules.Evaluator
	Models        *modelresolver.Resolver
	Health        *health.Registry
}

// NewDeps builds all infrastructure adapters from the given config.
// The returned context carries the enriched logger.
func NewDeps(ctx context.Context, cfg Config) (context.Context, *Deps, error) {
	if err := cfg.Log.Validate(); err != nil {
		return ctx, nil, err
	}
	logger := clog.New(ctx, cfg.Log)
	ctx = clog.Set(ctx, logger)
	nodeID := resolveNodeID(ctx)

	otelProvider, err := cfg.OTel.Configure(ctx, nodeID)
	if err != nil {
		return ctx, nil, fmt.Errorf("otel init: %w", err)
	}

	projectRegistry := customertracebridge.NewRegistry()
	bridge, err := customertracebridge.NewEmitter(ctx, customertracebridge.EmitterOptions{
		Registry: projectRegistry,
	})
	if err != nil {
		return ctx, nil, fmt.Errorf("customer trace bridge init: %w", err)
	}

	signer, err := controlplane.NewSigner(cfg.ControlPlane.InternalSecret, nodeID)
	if err != nil {
		return ctx, nil, fmt.Errorf("hmac signer init: %w", err)
	}
	verifier := jwtverify.NewJWTVerifier(
		cfg.ControlPlane.JWTSecret,
		cfg.ControlPlane.JWTSecretPrev,
		jwtverify.WithIssuer("langwatch-control-plane"),
		jwtverify.WithAudience("langwatch-gateway"),
	)
	svcInfo := contexts.MustGetServiceInfo(ctx)
	userAgent := fmt.Sprintf("langwatch-%s/%s", svcInfo.Service, svcInfo.Version)

	cpClient := controlplane.NewClient(controlplane.ClientOptions{
		BaseURL:   cfg.ControlPlane.BaseURL,
		Sign:      signer.Sign,
		Verifier:  verifier,
		UserAgent: userAgent,
		// Custom transport: OTel instrumentation wraps the pooled inner
		// transport so every control-plane RPC gets a span automatically.
		// The inner transport keeps connections warm to avoid TCP/TLS
		// handshake cost on auth-miss bursts.
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: otelhttp.NewTransport(&http.Transport{
				MaxIdleConnsPerHost: 100,
				IdleConnTimeout:     90 * time.Second,
				ForceAttemptHTTP2:   true,
			}, otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				return "controlplane " + r.Method + " " + r.URL.Path
			})),
		},
		Logger: logger,
	})

	authSvc, err := authresolver.New(authresolver.Options{
		Resolver:      cpClient,
		ConfigFetcher: cpClient,
		Logger:        logger,
		SoftBump:      cfg.AuthCache.SoftBump,
		HardGrace:     cfg.AuthCache.HardGrace,
	})
	if err != nil {
		return ctx, nil, fmt.Errorf("auth service init: %w", err)
	}

	router, err := providers.NewBifrostRouter(ctx, providers.BifrostOptions{
		Logger: logger,
	})
	if err != nil {
		return ctx, nil, fmt.Errorf("bifrost init: %w", err)
	}

	limiter, err := ratelimit.New(ratelimit.Options{})
	if err != nil {
		return ctx, nil, fmt.Errorf("ratelimit init: %w", err)
	}

	budgetOutbox := budget.NewOutbox(budget.OutboxOptions{
		Poster: cpClient,
		Logger: logger,
	})
	budgetChecker := budget.NewChecker(budget.CheckerOptions{
		Outbox: budgetOutbox,
		Logger: logger,
	})

	probes := health.New(contexts.MustGetServiceInfo(ctx).Environment)
	probes.RegisterReadiness("auth_cache_warm", func() (bool, string) {
		if authSvc.KnownRevision() == 0 {
			return false, "no revision observed yet"
		}
		return true, ""
	})
	probes.MarkStarted()

	return ctx, &Deps{
		Logger:        logger,
		NodeID:        nodeID,
		OTel:          otelProvider,
		TraceBridge:   bridge,
		TraceRegistry: projectRegistry,
		ControlPlane:  cpClient,
		Auth:          authSvc,
		Providers:     router,
		RateLimiter:   limiter,
		BudgetOutbox:  budgetOutbox,
		BudgetChecker: budgetChecker,
		Policy:        policy.NewMatcher(),
		Cache:         cacherules.NewEvaluator(),
		Models:        modelresolver.New(),
		Health:        probes,
	}, nil
}

func resolveNodeID(ctx context.Context) string {
	hostname, err := os.Hostname()
	if err != nil {
		id := ulid.Make().String()
		clog.Get(ctx).Warn("hostname_unavailable", zap.Error(err), zap.String("fallback_node_id", id))
		return id
	}
	return hostname
}

