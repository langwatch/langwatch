package domain

import (
	"fmt"
	"strings"
)

// DefaultLocalAPIKey is the stable local dev project API key haven seeds and
// injects when none is pinned. It is intentionally fixed and well-known so any
// worktree, script, or AI agent authenticates with the same key locally — the
// "the API key is always the same locally" contract. It is a legacy sk-lw-* full
// project key, matched by exact lookup on Project.apiKey.
const DefaultLocalAPIKey = "sk-lw-local-development-key"

// DefaultLangyInternalSecret is the stable local shared secret the control plane
// presents to the langyagent manager (and the manager requires). Fixed and
// well-known so both sides always match locally with no .env setup — the same
// "always the same locally" contract as DefaultLocalAPIKey.
const DefaultLangyInternalSecret = "langy-local-development-secret"

// svc looks a service up by name; a zero value is fine for the string formatting
// below when a stack is partial.
func (s Stack) svc(name string) Service {
	for _, x := range s.Services {
		if x.Name == name {
			return x
		}
	}
	return Service{}
}

// OverlayEnv returns the KEY=VALUE lines that carry the resolved hostname URLs +
// ports. These are (a) written to langwatch/.env.portless — the overlay every TS
// entry point loads last with override:true so it beats anything pinned in .env —
// and (b) injected directly into each supervised child. Deriving them from the
// Stack (which already holds every URL/port) keeps this the single source of
// truth with no file round-trip.
func (s Stack) OverlayEnv() []string {
	app, gw, nlp, langy := s.svc("app"), s.svc("gateway"), s.svc("nlp"), s.svc("langyagent")
	// The API is same-origin with the app: the browser (and any agent) uses one
	// URL, app.<slug>.../api, which Vite proxies to the API backend on loopback.
	// Server-to-server callers (Vite's /api proxy, the Go gateway's control-plane
	// client, langy) dial that loopback port directly — robust, no TLS/CA, no
	// second public hostname to confuse anyone.
	apiInternal := fmt.Sprintf("http://127.0.0.1:%d", s.APIPort)
	env := []string{
		"LANGWATCH_PORTLESS=1",
		"LANGWATCH_SLUG=" + s.Slug,
		fmt.Sprintf("LANGWATCH_APP_PORT=%d", app.Port),
		fmt.Sprintf("LANGWATCH_API_PORT=%d", s.APIPort),
		fmt.Sprintf("LANGWATCH_GATEWAY_PORT=%d", gw.Port),
		fmt.Sprintf("LANGWATCH_NLP_PORT=%d", nlp.Port),
		fmt.Sprintf("WORKER_METRICS_PORT=%d", s.WorkerMetricsPort),
		"BASE_HOST=" + app.URL,
		"NEXTAUTH_URL=" + app.URL,
		"LANGWATCH_ENDPOINT=" + app.URL,
		"LANGWATCH_API_URL=" + apiInternal,
		"LANGWATCH_NLP_SERVICE=" + nlp.URL,
		"GATEWAY_CONTROL_PLANE_URL=" + apiInternal,
		"LW_GATEWAY_BASE_URL=" + apiInternal,
		"LW_GATEWAY_PUBLIC_URL=" + gw.URL,
		"LW_GATEWAY_INTERNAL_URL=" + gw.URL,
		fmt.Sprintf("REDIS_DB_INDEX=%d", s.RedisDB),
		// Pretty, human-readable console logging for the Go services (clog reads
		// LOG_FORMAT; the TS app's pino is already pretty in dev via NODE_ENV). Haven
		// is always a human at the console, so the dev lanes should read like prose,
		// not JSON. Haven-dev only — this overlay never exists in prod, where the Go
		// services keep their JSON default. The collector still receives structured
		// records regardless of the console format (clog tees the two).
		"LOG_FORMAT=pretty",
	}
	// A stable local API key so the seed always mints the same credential and any
	// agent can authenticate without rediscovering it per worktree. Emitted as
	// HAVEN_SEED_LANGWATCH_API_KEY, never LANGWATCH_API_KEY: the latter is the langwatch
	// SDK trigger, and a platform process that had it set would self-instrument into
	// its own trace ingest. The TS + Go platform entry points panic if LANGWATCH_API_KEY
	// is ever set; domain_test.go pins that this overlay never emits it.
	if s.LocalAPIKey != "" {
		env = append(env, "HAVEN_SEED_LANGWATCH_API_KEY="+s.LocalAPIKey)
	}
	// The rest of the static seeded identity (see prisma/seed.ts's header comment
	// for the full rationale) — same story: fixed values so any worktree or agent
	// can log in / authenticate without rediscovering them.
	env = append(env,
		"LANGWATCH_ADMIN_EMAIL="+DefaultAdminEmail,
		"LANGWATCH_ADMIN_PASSWORD="+DefaultAdminPassword,
		"LANGWATCH_PRIVATE_ACCESS_TOKEN="+DefaultPrivateAccessToken,
		"LANGWATCH_PUBLIC_ACCESS_TOKEN="+DefaultPublicAccessToken,
		// ee/admin/isAdmin.ts gates platform-admin (impersonation etc.) on this
		// comma-separated list. The seeded admin needs to be in it, or logging in
		// as admin@haven.localhost gets a normal user, not a platform admin.
		"ADMIN_EMAILS="+DefaultAdminEmail,
	)
	// langyagent (the OpenCode manager): the control plane dials it at its loopback
	// port with the shared internal secret both sides require. Isolation (gVisor +
	// iptables egress control) is a production concern the local host can't provide,
	// so haven disables it here — the "unsafe dev" mode the manager exposes for
	// exactly this. Emitted whenever the service has a port (local or a baseline
	// fallback).
	if langy.Port != 0 {
		env = append(env,
			fmt.Sprintf("OPENCODE_AGENT_URL=http://127.0.0.1:%d", langy.Port),
			"LANGY_INTERNAL_SECRET="+DefaultLangyInternalSecret,
			"LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true",
		)
	}
	// haven manages one shared ClickHouse container; this stack gets its own
	// database on it. The app connects straight to loopback (HTTP, no proxy) at
	// the per-slug database, so migration counts are always this worktree's own.
	if s.ClickHouseHTTPPort != 0 && s.ClickHouseDatabase != "" {
		env = append(env, fmt.Sprintf("CLICKHOUSE_URL=http://%s:%s@127.0.0.1:%d/%s",
			ClickHouseUser, ClickHousePassword, s.ClickHouseHTTPPort, s.ClickHouseDatabase))
	}
	// Same story for Postgres: one shared brew-managed server, a database per
	// slug, connected straight to loopback.
	if s.PostgresPort != 0 && s.PostgresDatabase != "" {
		env = append(env, fmt.Sprintf("DATABASE_URL=postgresql://%s:%s@127.0.0.1:%d/%s",
			PostgresRole, PostgresRolePassword, s.PostgresPort, s.PostgresDatabase))
	}
	// Redis needs no per-slug database — REDIS_DB_INDEX above already partitions
	// worktrees by DB index on the one shared server.
	if s.RedisPort != 0 {
		env = append(env, fmt.Sprintf("REDIS_URL=redis://127.0.0.1:%d", s.RedisPort))
	}
	env = append(env, s.observabilityEnv()...)
	return env
}

// observabilityEnv wires this stack into the shared LGTM collector — the whole
// point of haven owning the observability stack. Because haven already knows the
// slug, telemetry is tagged with it automatically: an agent debugging this
// worktree filters Grafana to langwatch.worktree="<slug>" and sees only its own
// logs, traces and metrics, even with a dozen worktrees sharing the collector.
//
// Emitted only when the stack is actually up, so a contributor who never starts
// it exports nothing and pays nothing. While it IS up, haven also mutes the
// console to warn+ (ObservabilityConsoleLevel) because the full info/debug stream
// is now in Grafana — the terminal only needs what wants a human. That is the one
// place the overlay deliberately overrides .env; it is opt-outable
// (LW_OBS_CONSOLE_LEVEL="off"), and the OTel floor stays at debug so nothing is
// lost, just relocated.
func (s Stack) observabilityEnv() []string {
	if s.ObservabilityOTLPPort == 0 {
		return nil
	}
	otlp := fmt.Sprintf("http://127.0.0.1:%d", s.ObservabilityOTLPPort)
	env := []string{
		"OTEL_EXPORTER_OTLP_ENDPOINT=" + otlp,   // TS: traces + logs + metrics
		"OTEL_DEBUG_COLLECTOR_ENDPOINT=" + otlp, // Go: dual-export, additive to the product trace path
		"PINO_OTEL_ENABLED=true",
		"OTEL_METRICS_ENABLED=true",
		"LOG_OTEL_LEVEL=debug",
		"OTEL_RESOURCE_ATTRIBUTES=" + ObservabilityWorktreeAttr + "=" + s.Slug,
	}
	// The Grafana base URL, so the app can build clickable trace/log deep links.
	// Loopback: the link is followed by the developer's own browser on this machine.
	if s.ObservabilityGrafanaPort != 0 {
		env = append(env, fmt.Sprintf("GRAFANA_BASE_URL=http://127.0.0.1:%d", s.ObservabilityGrafanaPort))
	}
	// Quiet the console to warn+ (the full stream is in Grafana). Empty = opt-out.
	if s.ObservabilityConsoleLevel != "" {
		env = append(env, "LOG_CONSOLE_LEVEL="+s.ObservabilityConsoleLevel)
	}
	return env
}

// OverlayFile renders the .env.portless file body (header + OverlayEnv).
func (s Stack) OverlayFile() string {
	var b strings.Builder
	b.WriteString("# --- generated by haven (thuishaven) — do not edit ---\n")
	b.WriteString(fmt.Sprintf("# Portless hostname routing for the %q stack (worktree: %s).\n", s.Slug, s.WorktreeDir))
	b.WriteString("# Loaded last with override:true so these win over anything pinned in .env.\n")
	for _, line := range s.OverlayEnv() {
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return b.String()
}
