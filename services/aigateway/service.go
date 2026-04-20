// Package aigateway is the AI Gateway service.
package aigateway

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	otelapi "go.opentelemetry.io/otel"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/app/authcache"
	"github.com/langwatch/langwatch/services/aigateway/app/blockedmatch"
	"github.com/langwatch/langwatch/services/aigateway/app/budgetctl"
	"github.com/langwatch/langwatch/services/aigateway/app/cacherules"
	"github.com/langwatch/langwatch/services/aigateway/app/guardrailctl"
	"github.com/langwatch/langwatch/services/aigateway/app/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/app/providers"
	"github.com/langwatch/langwatch/services/aigateway/app/ratelimit"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/aigateway/infra"
	transport "github.com/langwatch/langwatch/services/aigateway/transport/http"
)

// Config is the top-level service configuration.
type Config struct {
	Server       config.Server      `env:"GATEWAY"`
	Log          clog.Config        `env:"GATEWAY_LOG"`
	ControlPlane ControlPlaneConfig `env:"GATEWAY_CONTROL_PLANE"`
	OTel         OTelConfig         `env:"GATEWAY_OTEL"`
}

// ControlPlaneConfig holds control plane connection settings.
type ControlPlaneConfig struct {
	BaseURL        string `env:"BASE_URL"`
	InternalSecret string `env:"INTERNAL_SECRET"`
	JWTSecret      string `env:"JWT_SECRET"`
	JWTSecretPrev  string `env:"JWT_SECRET_PREVIOUS"`
}

// OTelConfig holds telemetry settings.
type OTelConfig struct {
	// GatewayEndpoint is OUR ops collector (empty = noop).
	GatewayEndpoint  string `env:"GATEWAY_ENDPOINT"`
	GatewayAuthToken string `env:"GATEWAY_AUTH_TOKEN"`
	// DefaultExportEndpoint is the OTLP endpoint for customer AI traces
	// when no per-project endpoint is configured.
	DefaultExportEndpoint string `env:"DEFAULT_EXPORT_ENDPOINT"`
	DefaultAuthToken      string `env:"DEFAULT_AUTH_TOKEN"`
}

func defaultConfig() Config {
	return Config{
		Server: config.Server{
			Addr:            ":5563",
			GracefulSeconds: 10,
		},
	}
}

// Run is the service entrypoint. Wires all dependencies and blocks until shutdown.
func Run(ctx context.Context) error {
	cfg := defaultConfig()
	if err := config.Hydrate(&cfg); err != nil {
		return fmt.Errorf("config hydration: %w", err)
	}

	logger := clog.New(cfg.Log)
	ctx = clog.Set(ctx, logger)
	logger.Info("aigateway_starting", zap.String("addr", cfg.Server.Addr))

	nodeID, _ := os.Hostname()

	// --- Telemetry (two separate tracers) ---

	// 1. Gateway ops tracer (our observability, our trace IDs)
	gwTracer, err := infra.NewGatewayTracer(ctx, infra.GatewayTracerOptions{
		ServiceName:    "langwatch-ai-gateway",
		ServiceVersion: "dev",
		NodeID:         nodeID,
		Endpoint:       cfg.OTel.GatewayEndpoint,
		Headers:        tokenHeaders(cfg.OTel.GatewayAuthToken),
	})
	if err != nil {
		return fmt.Errorf("gateway tracer init: %w", err)
	}
	otelapi.SetTextMapPropagator(gwTracer.Propagator())
	if tp := gwTracer.TracerProvider(); tp != nil {
		otelapi.SetTracerProvider(tp)
	}

	// 2. Customer AI tracer (inherits client traceparent, per-project routing)
	projectRegistry := infra.NewProjectRegistry()
	aiTracer, err := infra.NewAITracer(ctx, infra.AITracerOptions{
		Registry: projectRegistry,
	})
	if err != nil {
		return fmt.Errorf("ai tracer init: %w", err)
	}

	// --- Auth ---
	auth, err := authcache.New(authcache.Options{
		BaseURL:           cfg.ControlPlane.BaseURL,
		InternalSecret:    cfg.ControlPlane.InternalSecret,
		JWTSecret:         cfg.ControlPlane.JWTSecret,
		JWTSecretPrevious: cfg.ControlPlane.JWTSecretPrev,
		NodeID:            nodeID,
		Logger:            logger,
		OnResolved: func(b *domain.Bundle) {
			// Populate per-project OTLP routing
			if b.ProjectID != "" && b.Config.ProjectOTLPToken != "" && cfg.OTel.DefaultExportEndpoint != "" {
				if err := projectRegistry.Set(
					b.ProjectID,
					cfg.OTel.DefaultExportEndpoint,
					map[string]string{"X-Auth-Token": b.Config.ProjectOTLPToken},
				); err != nil {
					logger.Warn("otlp_endpoint_rejected", zap.String("project_id", b.ProjectID), zap.Error(err))
				}
			}
		},
	})
	if err != nil {
		return fmt.Errorf("auth cache init: %w", err)
	}

	// --- Provider router ---
	router, err := providers.NewBifrostRouter(ctx, providers.BifrostOptions{
		Logger: logger,
	})
	if err != nil {
		return fmt.Errorf("bifrost init: %w", err)
	}

	// --- Rate limiter ---
	limiter, err := ratelimit.New(ratelimit.Options{})
	if err != nil {
		return fmt.Errorf("ratelimit init: %w", err)
	}

	// --- Budget ---
	budgetOutbox := budgetctl.NewOutbox(budgetctl.OutboxOptions{
		Endpoint: cfg.ControlPlane.BaseURL + "/api/internal/gateway/budget/debit",
		Sign:     auth.SignRequest,
		Logger:   logger,
	})
	budget := budgetctl.NewChecker(budgetctl.CheckerOptions{
		Outbox: budgetOutbox,
		Logger: logger,
	})

	// --- Guardrails ---
	guardrails := guardrailctl.New(guardrailctl.Options{
		ControlPlaneBaseURL: cfg.ControlPlane.BaseURL,
		Sign:                auth.SignRequest,
		Logger:              logger,
	})

	// --- Application layer ---
	application := app.New(
		app.WithAuth(auth),
		app.WithProviders(router),
		app.WithRateLimiter(limiter),
		app.WithBudget(budget),
		app.WithGuardrails(guardrails),
		app.WithBlocked(blockedmatch.NewMatcher()),
		app.WithCache(cacherules.NewEvaluator()),
		app.WithModels(modelresolver.New()),
		app.WithLogger(logger),
	)

	// --- Health probes ---
	probes := health.New("dev")
	probes.RegisterReadiness("auth_cache_warm", func() (bool, string) {
		if auth.KnownRevision() == 0 {
			return false, "no revision observed yet"
		}
		return true, ""
	})
	probes.MarkStarted()

	// --- HTTP transport ---
	handler := transport.NewRouter(transport.RouterDeps{
		App:           application,
		Logger:        logger,
		Health:        probes,
		Version:       "dev",
		GatewayTracer: gwTracer,
	})

	srv := &http.Server{Handler: handler, Addr: cfg.Server.Addr}

	// --- Lifecycle: ordered start, K8s-friendly shutdown ---
	g := lifecycle.New(logger,
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithHealth(probes),
	)
	g.Add(
		lifecycle.Closer("gateway-tracer", gwTracer.Shutdown),
		lifecycle.Closer("ai-tracer", aiTracer.Shutdown),
		lifecycle.Worker("auth-cache", auth.Start, auth.Stop),
		lifecycle.Worker("budget-outbox", budgetOutbox.Start, budgetOutbox.Stop),
		lifecycle.ListenServer("http", srv),
	)
	return g.Run(ctx)
}

func tokenHeaders(token string) map[string]string {
	if token == "" {
		return nil
	}
	return map[string]string{"Authorization": "Bearer " + token}
}
