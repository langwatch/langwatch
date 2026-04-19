// Command gateway is the LangWatch AI Gateway — an OpenAI-compatible and
// Anthropic-compatible HTTP front-end that routes requests to provider
// backends via github.com/maximhq/bifrost/core with virtual-key auth,
// budgets, guardrails, multi-tenant OTel, and caching passthrough.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	_ "net/http/pprof" // side-effect import registers /debug/pprof/* on http.DefaultServeMux
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/budget"
	"github.com/langwatch/langwatch/services/gateway/internal/config"
	"github.com/langwatch/langwatch/services/gateway/internal/dispatch"
	"github.com/langwatch/langwatch/services/gateway/internal/guardrails"
	"github.com/langwatch/langwatch/services/gateway/internal/handlers"
	"github.com/langwatch/langwatch/services/gateway/internal/health"
	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
	"github.com/langwatch/langwatch/services/gateway/internal/logx"
	"github.com/langwatch/langwatch/services/gateway/internal/metrics"
	"github.com/langwatch/langwatch/services/gateway/internal/netcheck"
	gwotel "github.com/langwatch/langwatch/services/gateway/internal/otel"
	"github.com/langwatch/langwatch/services/gateway/internal/ratelimit"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var Version = "dev"

func main() {
	cfg, err := config.Load()
	if err != nil {
		// Logger isn't up yet; use fmt via slog default.
		slog.Default().Error("config_load_failed", "err", err.Error())
		os.Exit(2)
	}
	logger := logx.New(cfg.LogLevel)
	// Echo the effective config (secrets redacted) so operators can
	// verify which env overrides actually took effect without shelling
	// into the pod. One line, key/value pairs, greppable as
	// `gateway_effective_config`.
	logger.Info("gateway_effective_config", cfg.LogFields()...)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	nodeID := os.Getenv("GATEWAY_NODE_ID")
	if nodeID == "" {
		if h, err := os.Hostname(); err == nil {
			nodeID = h
		} else {
			nodeID = "gw-unknown"
		}
	}
	resolver := auth.NewHTTPResolver(auth.HTTPResolverOptions{
		BaseURL:           cfg.ControlPlane.BaseURL,
		InternalSecret:    cfg.ControlPlane.InternalSecret,
		JWTSecret:         cfg.ControlPlane.JWTSecret,
		JWTSecretPrevious: cfg.ControlPlane.JWTSecretPrevious,
		GatewayNodeID:     nodeID,
		Timeout:           cfg.ControlPlane.RequestTimeout,
	})
	if cfg.ControlPlane.JWTSecretPrevious != "" {
		logger.Warn("jwt_secret_rotation_active",
			"msg", "accepting tokens signed with LW_GATEWAY_JWT_SECRET_PREVIOUS — remove once all pre-rotation bundles have expired (max TTL ~15m)")
	}

	var redisClient redis.UniversalClient
	if cfg.Cache.RedisURL != "" {
		opts, err := redis.ParseURL(cfg.Cache.RedisURL)
		if err != nil {
			logger.Error("redis_parse_url_failed", "err", err.Error())
			os.Exit(2)
		}
		redisClient = redis.NewClient(opts)
	}

	// Per-project OTLP endpoint registry. Populated via the auth cache
	// hook as VK bundles are resolved; read on every span export by
	// RouterExporter. Each customer's gateway spans land in their own
	// LangWatch project (same project their SDK already reports to),
	// so traces nest cleanly instead of fragmenting across projects.
	projectEndpoints := gwotel.NewProjectEndpointRegistry()
	// rlim is referenced in the cache hook below so rate-limit
	// ceilings rebuild after a config revision bump.
	var ratelimitRef *ratelimit.Limiter

	cache, err := auth.NewCache(resolver, logger, auth.CacheOptions{
		LRUSize:             cfg.Cache.LRUSize,
		RefreshInterval:     cfg.Cache.RefreshInterval,
		JWTRefreshThreshold: cfg.Cache.JWTRefreshThreshold,
		Redis:               redisClient,
		OnBundleResolved: func(b *auth.Bundle) {
			projectEndpoints.Set(b.ProjectID(), b.Config.ObservabilityEndpoint, nil)
			if ratelimitRef != nil {
				// Drop cached buckets so the next Allow() rebuilds
				// with whatever the new revision's ceilings are. The
				// limiter itself also detects ceiling drift on read,
				// but explicitly invalidating avoids one spurious
				// allow on the refresh boundary.
				ratelimitRef.Invalidate(b.VirtualKeyID())
			}
		},
	})
	if err != nil {
		logger.Error("cache_init_failed", "err", err.Error())
		os.Exit(2)
	}
	cache.Start(ctx)
	defer cache.Stop()

	signInternal := func(req *http.Request, body []byte) {
		resolver.(auth.RequestSigner).SignRequest(req, body)
	}
	met := metrics.New()
	budgetOutbox := budget.NewOutbox(budget.OutboxOptions{
		ControlPlaneBaseURL: cfg.ControlPlane.BaseURL,
		Sign:                signInternal,
		Logger:              logger,
		HTTPTimeout:         cfg.ControlPlane.RequestTimeout,
		FlushEvery:          cfg.Budget.OutboxFlushInterval,
		MaxRetries:          cfg.Budget.OutboxMaxRetries,
		Metrics: budget.OutboxMetrics{
			OnCapacityDrop: met.BudgetOutboxDrop.Inc,
			OnFlushFailure: met.BudgetOutboxFlushFailure.Inc,
			On4xxDrop:      met.BudgetOutbox4xxDrop.Inc,
		},
	})
	met.BudgetOutboxCapacity.Set(float64(budgetOutbox.Capacity()))
	budgetOutbox.Start(ctx)
	defer budgetOutbox.Stop()

	guardrailClient := guardrails.New(guardrails.Options{
		ControlPlaneBaseURL: cfg.ControlPlane.BaseURL,
		Sign:                signInternal,
		Logger:              logger,
		Timeouts: guardrails.Timeouts{
			Pre:         cfg.Guardrails.PreTimeout,
			Post:        cfg.Guardrails.PostTimeout,
			StreamChunk: cfg.Guardrails.StreamChunkWindow,
		},
	})

	budgetChecker := budget.NewChecker(budget.CheckerOptions{
		ControlPlaneBaseURL: cfg.ControlPlane.BaseURL,
		Sign:                signInternal,
		Logger:              logger,
		NearLimitPct:        cfg.Budget.LiveThresholdPct,
		Timeout:             cfg.Budget.LiveTimeout,
	})

	// Background pump: keep the budget-outbox depth gauge fresh so
	// BudgetDebitOutboxStale alerts can fire even when no inbound
	// request is rolling new events through the hot path.
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				met.BudgetOutboxDepth.Set(float64(budgetOutbox.Depth()))
			}
		}
	}()

	rlim, err := ratelimit.New(ratelimit.Options{})
	if err != nil {
		logger.Error("ratelimit_init_failed", "err", err.Error())
		os.Exit(2)
	}
	ratelimitRef = rlim // now visible to the cache hook above

	dispatcher, err := dispatch.New(ctx, dispatch.Options{
		Logger:          logger,
		Budget:          budgetOutbox,
		BudgetChecker:   budgetChecker,
		Guardrails:      guardrailClient,
		Metrics:         met,
		RateLimiter:     rlim,
		InitialPoolSize: cfg.Bifrost.PoolSize,
	})
	if err != nil {
		logger.Error("dispatcher_init_failed", "err", err.Error())
		os.Exit(2)
	}

	// OTel: per-tenant routing exporter + gateway tracer. Even without a
	// configured OTLP endpoint we want the propagator live so incoming
	// `traceparent` headers parent the gateway span — the user's SDK
	// already reports full token usage, so nesting (not duplicating) is
	// the only correct behaviour. When DefaultExportEndpoint is empty we
	// fall back to a no-op exporter that still participates in W3C
	// propagation.
	otelRouter, err := gwotel.NewRouterExporter(ctx, gwotel.RouterOptions{
		DefaultEndpoint: cfg.OTel.DefaultExportEndpoint,
		Timeout:         cfg.ControlPlane.RequestTimeout,
		Resolver:        projectEndpoints.Lookup,
	})
	if err != nil {
		logger.Error("otel_exporter_init_failed", "err", err.Error())
		os.Exit(2)
	}
	otelProvider := gwotel.New(gwotel.ProviderOptions{
		ServiceName:    "langwatch-ai-gateway",
		ServiceVersion: Version,
		GatewayNodeID:  nodeID,
		Logger:         logger,
		Router:         otelRouter,
		BatchTimeout:   cfg.OTel.BatchTimeout,
		MaxQueueSize:   cfg.OTel.MaxQueueSize,
	})
	defer func() {
		sctx, scancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer scancel()
		_ = otelProvider.Shutdown(sctx)
	}()

	hreg := health.New(Version)
	hreg.RegisterReadiness("control_plane_reachable", func() (bool, string) {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, "GET", cfg.ControlPlane.BaseURL+"/api/internal/gateway/health", nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return false, "control plane unreachable: " + err.Error()
		}
		resp.Body.Close()
		if resp.StatusCode >= 500 {
			return false, "control plane 5xx"
		}
		return true, ""
	})
	hreg.RegisterReadiness("auth_cache_warm", func() (bool, string) {
		if cache.KnownRevision() == 0 {
			return false, "auth cache has not observed any revision yet"
		}
		return true, ""
	})
	if redisClient != nil {
		hreg.RegisterReadiness("redis_reachable", func() (bool, string) {
			ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
			defer cancel()
			if err := redisClient.Ping(ctx).Err(); err != nil {
				return false, "redis ping failed: " + err.Error()
			}
			return true, ""
		})
	}
	// Startup gate. MarkStarted only flips once every configured
	// netcheck host can be DNS-resolved + TCP-dialed. Catches the
	// classic NetworkPolicy misconfig where /healthz passes but the
	// first real upstream request dies on egress denial. Empty host
	// list (the default) skips the probe after a 2s grace so
	// greenfield deploys without providers configured still start.
	startupHosts, err := netcheck.ParseHosts(cfg.Startup.NetcheckHostsRaw)
	if err != nil {
		logger.Error("startup_netcheck_hosts_invalid", "err", err.Error(), "raw", cfg.Startup.NetcheckHostsRaw)
		os.Exit(2)
	}
	prober := &netcheck.Prober{PerHostTimeout: cfg.Startup.NetcheckTimeout}
	go func() {
		if len(startupHosts) == 0 {
			time.Sleep(2 * time.Second)
			hreg.MarkStarted()
			return
		}
		names := make([]string, len(startupHosts))
		for i, h := range startupHosts {
			names[i] = h.Addr
		}
		logger.Info("startup_netcheck_probing", "hosts", names, "timeout", cfg.Startup.NetcheckTimeout.String())
		if perr := prober.Probe(ctx, startupHosts); perr != nil {
			// Don't MarkStarted. k8s startup probe will fail and recycle
			// the pod, surfacing the misconfig in the deploy rollout
			// rather than in the first customer request.
			logger.Error("startup_netcheck_failed", "err", perr.Error())
			return
		}
		logger.Info("startup_netcheck_ok")
		hreg.MarkStarted()
	}()

	r := chi.NewRouter()
	r.Use(httpx.RequestID)
	r.Use(httpx.Recover(logger))
	r.Use(httpx.AccessLog(logger))
	// InFlight gauge tracks active requests globally — the primary
	// drain-progress signal during rollout. Runs before any enforcement
	// so its count reflects real request-path occupancy, including
	// rejected 4xx / 5xx that still briefly sit in a handler.
	r.Use(httpx.InFlight(met.InFlightRequests))
	// X-LangWatch-Gateway-Version on every response — breadcrumb for
	// operators ("which deploy served this") and SDK version-gating.
	r.Use(httpx.Version(Version))

	r.Get("/healthz", hreg.Liveness)
	r.Get("/readyz", hreg.Readiness)
	r.Get("/startupz", hreg.Startup)
	// /metrics is scraped by Prometheus every 15s. Uses the gateway-
	// owned registry so Go runtime + process + gateway-specific
	// collectors are all exposed from a single endpoint.
	r.Handle("/metrics", promhttp.HandlerFor(met.Registry, promhttp.HandlerOpts{}))

	r.Route("/v1", func(v1 chi.Router) {
		// OTel middleware runs BEFORE auth so a) unauthed 401s still get
		// a span (observability of probe-abuse / misconfigured CLIs),
		// b) the traceparent in the response header is set even on
		// error paths so client SDKs can reconcile.
		v1.Use(gwotel.Middleware(otelProvider, gwotel.DefaultSpanName))
		// Body size cap protects the pod from OOM. Runs before auth so
		// a bot hammering with multi-GB payloads is rejected before any
		// cache / resolve-key work.
		v1.Use(httpx.MaxBodyBytes(cfg.Security.MaxRequestBodyBytes))
		v1.Use(auth.Middleware(cache))
		v1.Get("/models", handlers.Models)
		v1.Post("/chat/completions", (&handlers.ChatHandler{Dispatcher: dispatcher}).ServeHTTP)
		v1.Post("/messages", (&handlers.MessagesHandler{Dispatcher: dispatcher}).ServeHTTP)
		v1.Post("/embeddings", (&handlers.EmbeddingsHandler{Dispatcher: dispatcher}).ServeHTTP)
	})

	server := &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: r,
		// Slowloris mitigation: bound header + body read time and
		// keep-alive idle lifetime. WriteTimeout is deliberately
		// unset — it would terminate long SSE streams.
		ReadHeaderTimeout: cfg.Security.ReadHeaderTimeout,
		ReadTimeout:       cfg.Security.ReadTimeout,
		IdleTimeout:       cfg.Security.IdleTimeout,
	}

	// Admin listener (pprof). Deliberately bound to loopback by
	// default so NLB ingress never reaches it. Operators k8s-exec
	// or port-forward to inspect live goroutines / heap. Empty
	// GATEWAY_ADMIN_ADDR disables the listener entirely.
	//
	// Non-k8s deployments that can't port-forward may move the admin
	// listener to a routable interface — config.validate() rejects
	// that unless GATEWAY_ADMIN_AUTH_TOKEN is set, and the handler
	// below wraps pprof in a bearer-token gate whenever a token is
	// configured (even on loopback, as an optional second defence).
	var adminServer *http.Server
	if cfg.AdminAddr != "" {
		var adminHandler http.Handler = http.DefaultServeMux // net/http/pprof registers here
		if cfg.AdminAuthToken != "" {
			adminHandler = httpx.RequireBearer(cfg.AdminAuthToken, "gateway-admin", adminHandler)
		}
		adminServer = &http.Server{
			Addr:              cfg.AdminAddr,
			Handler:           adminHandler,
			ReadHeaderTimeout: cfg.Security.ReadHeaderTimeout,
			ReadTimeout:       cfg.Security.ReadTimeout,
			IdleTimeout:       cfg.Security.IdleTimeout,
		}
		go func() {
			logger.Info("admin_listening",
				"addr", cfg.AdminAddr,
				"auth_required", cfg.AdminAuthToken != "",
				"loopback_only", httpx.IsLoopbackAddr(cfg.AdminAddr),
			)
			if err := adminServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				logger.Error("admin_server_error", "err", err.Error())
			}
		}()
	}

	go func() {
		logger.Info("gateway_listening", "addr", cfg.ListenAddr, "version", Version)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http_server_error", "err", err.Error())
			os.Exit(1)
		}
	}()

	<-ctx.Done()

	// Graceful drain:
	//   1. Flip /readyz to 503 so the LB / Service endpoint controller
	//      stops routing new traffic to this pod.
	//   2. Sleep PreDrainWait so the endpoint removal propagates. Without
	//      this, server.Shutdown races LB propagation and the last
	//      second of traffic still lands on a pod that's closing.
	//   3. Call server.Shutdown — blocks until in-flight handlers exit
	//      OR Timeout elapses (force-close, mid-stream break).
	//   4. Operators watch `gateway_in_flight_requests` to see drain
	//      progress; stuck drain = in_flight flat > 0 for the whole
	//      grace period.
	hreg.MarkDraining()
	met.Draining.Set(1)
	logger.Info("gateway_draining", "pre_drain_wait", cfg.Shutdown.PreDrainWait.String())
	if cfg.Shutdown.PreDrainWait > 0 {
		time.Sleep(cfg.Shutdown.PreDrainWait)
	}

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), cfg.Shutdown.Timeout)
	defer cancelShutdown()
	logger.Info("gateway_shutting_down", "timeout", cfg.Shutdown.Timeout.String())
	_ = server.Shutdown(shutdownCtx)
	if adminServer != nil {
		_ = adminServer.Shutdown(shutdownCtx)
	}
	logger.Info("gateway_stopped")
}
