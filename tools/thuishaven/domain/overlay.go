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

// DefaultRetentionDays is the platform retention default haven pins for a dev
// stack: one week, so an unseeded worktree's ClickHouse stays tiny and whole
// weekly partitions drop cleanly (the partition key is toYearWeek, so retention
// must be a whole number of weeks). Emitted as LANGWATCH_DEFAULT_RETENTION_DAYS,
// which the control plane reads ONLY outside production — it fails loud if that
// var is ever set in prod, where the default is fixed. A seeded DB overrides
// this with a two-year, partition-aligned RetentionPolicy so the seeded history
// survives. NOTHING DOES THAT TODAY: the step that pinned it (seed:retention)
// went with the platform application, and no shipped preset loads backdated
// data that would need it. Restore both together — see db.go's seedPreset.
const DefaultRetentionDays = 7

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

// OverlayEnv returns the KEY=VALUE lines that carry the resolved hostname URLs
// + ports. They are injected directly into the environment of every child haven
// starts, and printed by `haven env` for a shell — nothing writes them to a
// file. Deriving them from the Stack (which already holds every URL/port) keeps
// this the single source of truth, and keeping them in memory means a checkout
// never holds a stale copy of a stack that has since come down.
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
		// Same loopback principle as LANGWATCH_API_URL above: the control
		// plane's server-side gateway calls (codex assists) must not depend
		// on Node trusting the portless CA.
		fmt.Sprintf("LW_GATEWAY_INTERNAL_URL=http://127.0.0.1:%d", gw.Port),
		fmt.Sprintf("REDIS_DB_INDEX=%d", s.RedisDB),
		// The shared structured format on every lane, dev included
		// (dev/docs/best_practices/dev-log-format.md). Haven is always a human at
		// the console, and it is haven that renders for them — one renderer over
		// eight identical streams, instead of eight pretty consoles that each
		// invent their own clock and level column. `LOG_FORMAT=pretty` is still
		// there for a lane run bare in its own terminal.
		"LOG_FORMAT=json",
		// A tiny default retention for the dev stack: an unseeded worktree keeps a
		// week of data so ClickHouse stays small and whole weekly partitions drop
		// cleanly. Haven-dev only — the control plane fails loud if this var is set
		// in prod, where the platform default is fixed. Nothing raises it: the
		// seed:retention step that did went with the platform application, and no
		// shipped preset loads data old enough to need it (see db.go).
		fmt.Sprintf("LANGWATCH_DEFAULT_RETENTION_DAYS=%d", DefaultRetentionDays),
	}
	// The IdP simulator is an opt-in lane; only a worktree actually running (or
	// falling back to) one gets the pointer, so nothing reads a dead URL.
	if idp := s.svc("idp"); idp.Port != 0 && idp.URL != "" {
		// Where the simulator is, and — the part the platform cannot work out
		// on its own — that it may be TRUSTED. The engine refuses to fetch an
		// issuer's discovery document from an origin nobody vouched for,
		// which is what stops a server being pointed at an arbitrary address;
		// a simulator on a sibling hostname is exactly the arbitrary address
		// it refuses, so a local single sign-on journey cannot start without
		// this line.
		env = append(env,
			"LANGWATCH_IDPSIM_URL="+idp.URL,
			"SSO_TRUSTED_IDP_ORIGINS="+idp.URL,
		)
		// And its NAMESERVER, because the domains a local walk claims are
		// reserved names like `acme.test` that no public resolver will ever
		// answer for. The simulator is authoritative for them and the
		// machine's resolver has never heard of it, so a domain proof that
		// does not ask it can only ever fail.
		if idp.DNSPort != 0 {
			env = append(env, fmt.Sprintf("SSO_DOMAIN_PROOF_DNS_SERVERS=127.0.0.1:%d", idp.DNSPort))
		}
	}
	// The design system's Storybook. The ui lane frames it at /design-system and
	// starts one itself on the first visit unless something is already listening
	// on the port it derives — so naming haven's port here is what makes the two
	// agree: the lane haven supervises IS the listener the route finds, instead
	// of a second Storybook building the same stories on a different port.
	// Emitted only when there is a Storybook to point at (a local lane, or a
	// baseline stack's), so a worktree that never selected it keeps today's
	// start-on-first-visit behavior untouched.
	if sb := s.svc(DesignSystemService); sb.Port != 0 {
		env = append(env, fmt.Sprintf("LANGWATCH_STORYBOOK_PORT=%d", sb.Port))
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
	// Google DLP off by default locally: no local workflow wants trace text leaving
	// for Google, and the app skips loading @google-cloud/dlp (grpc + generated
	// protos) entirely when this is set. False emits nothing, leaving .env to decide
	// — which is how you opt back in to running the DLP check locally.
	if s.DisableGoogleDLP {
		env = append(env, "LANGWATCH_DISABLE_GOOGLE_DLP=true")
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
	// langyagent (the worker manager): the control plane dials it at its loopback
	// port with the shared internal secret both sides require. Emitted whenever the
	// service has a port (local or a baseline fallback). The isolation posture
	// (LANGY_UNSAFE_DEV_DISABLE_ISOLATION) is NOT set here — it is a langyagent-only
	// concern the plan sets on the worker itself per tier (see LangyTier); the
	// control plane never reads it.
	if langy.Port != 0 {
		env = append(env,
			fmt.Sprintf("LANGY_AGENT_URL=http://127.0.0.1:%d", langy.Port),
			"LANGY_INTERNAL_SECRET="+DefaultLangyInternalSecret,
		)
		// When the worker runs inside colima (the sandboxed / container-unsafe
		// tiers), it cannot reach the control plane or the gateway at 127.0.0.1 or
		// the portless .localhost hostnames — those resolve to the container itself.
		// Hand it host-reachable overrides: colima maps host.docker.internal to the
		// macOS host (verified reaching even loopback-bound listeners), and the raw
		// ports skip the portless HTTPS proxy and its CA entirely. The control plane
		// prefers these over LANGWATCH_ENDPOINT / LW_GATEWAY_* when building the
		// worker's credentials envelope (see LangyCredentialService). On the host
		// tier they are absent, so the worker keeps using the normal portless URLs.
		if s.LangyTier.RunsInContainer() {
			env = append(env,
				fmt.Sprintf("LANGY_WORKER_CALLBACK_URL=http://host.docker.internal:%d", s.APIPort),
				fmt.Sprintf("LANGY_WORKER_GATEWAY_URL=http://host.docker.internal:%d", gw.Port),
			)
		}
	}
	// haven manages one shared ClickHouse container; this stack gets its own
	// database on it. The app connects straight to loopback (HTTP, no proxy) at
	// the per-slug database, so migration counts are always this worktree's own.
	if s.ClickHouseHTTPPort != 0 && s.ClickHouseDatabase != "" {
		env = append(env, fmt.Sprintf("CLICKHOUSE_URL=http://%s:%s@127.0.0.1:%d/%s",
			ClickHouseUser, ClickHousePassword, s.ClickHouseHTTPPort, s.ClickHouseDatabase))
		// Backup-status gauges query system.backup_log, which only exists once
		// backups are configured, a production concern. The app collects them by
		// default (unset must not disarm the production alerts that read them), so
		// haven's container, which has no backups, opts out explicitly. Otherwise
		// every 15s stats tick would fail on a missing table for nothing.
		env = append(env, "CLICKHOUSE_BACKUP_METRICS_ENABLED=false")
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
	env = append(env, NodeOptionsEnvFromProcess())
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
		return TelemetryOffEnv()
	}
	otlp := fmt.Sprintf("http://127.0.0.1:%d", s.ObservabilityOTLPPort)
	env := []string{
		"OTEL_EXPORTER_OTLP_ENDPOINT=" + otlp,   // official name — TS app AND Go services (their own telemetry)
		"OTEL_DEBUG_COLLECTOR_ENDPOINT=" + otlp, // Go OTLP logs ride this; span/metric export dedupes when equal to the official endpoint
		"PINO_OTEL_ENABLED=true",
		"OTEL_METRICS_ENABLED=true",
		"LOG_OTEL_LEVEL=debug",
		"OTEL_RESOURCE_ATTRIBUTES=" + ObservabilityWorktreeAttr + "=" + s.Slug,
		// Browser telemetry (ADR-058). Tied to the collector rather than flagged
		// separately: the app proxies the browser's OTLP to the same endpoint, so
		// without a collector the exporter would post to a route with nowhere to
		// forward to. The frontend half of a trace is exactly what a developer
		// debugging their own worktree wants, so it is on whenever the stack is.
		"RUM_ENABLED=true",
	}
	// The Grafana base URL, so the app can build clickable trace/log deep links.
	// The proxied hostname when the portless proxy carries the route (stable,
	// matches every other haven surface); loopback otherwise — either way the
	// link is followed by the developer's own browser on this machine.
	if s.ObservabilityGrafanaURL != "" {
		env = append(env, "GRAFANA_BASE_URL="+s.ObservabilityGrafanaURL)
	} else if s.ObservabilityGrafanaPort != 0 {
		env = append(env, fmt.Sprintf("GRAFANA_BASE_URL=http://127.0.0.1:%d", s.ObservabilityGrafanaPort))
	}
	// Continuous profiling. Named only while Pyroscope is actually listening,
	// because the profiler is a push: with nowhere to push to, a process that
	// started one would sample itself on a timer, fail every upload, and pay the
	// native profiler's boot cost for nothing. Absence of this variable is the off
	// switch, exactly as OTEL_EXPORTER_OTLP_ENDPOINT's absence is for traces.
	//
	// The service name and the worktree tag come from the OTel variables above, so
	// a flame graph is attributable to the same service and worktree as the trace
	// beside it without a second set of identity variables to keep in step.
	if s.ObservabilityPyroscopePort != 0 {
		env = append(env, fmt.Sprintf("PYROSCOPE_SERVER_ADDRESS=http://127.0.0.1:%d", s.ObservabilityPyroscopePort))
	}
	// Quiet the console to warn+ (the full stream is in Grafana). Empty = opt-out.
	if s.ObservabilityConsoleLevel != "" {
		env = append(env, "LOG_CONSOLE_LEVEL="+s.ObservabilityConsoleLevel)
	}
	return env
}

// LaneEnv is the line that tells one supervised child which lane it is. It is
// the same signal dev/scripts/lane.sh sets for the plain `pnpm dev` path
// (LANGWATCH_LANE) and that the Makefile's `service`/`service-watch` targets
// check before piping a Go service's own JSON through their own copy of
// dev/scripts/log-render.mjs (Makefile:141): a renderer is already in front of
// every lane haven supervises, so a nested one must not run too, or the same
// line prints twice - once rendered by the launcher script, once by haven.
// Every child gets it, not only the Go lanes that read it today, so the
// invariant holds for whatever a future recipe checks.
func LaneEnv(lane string) string {
	return "LANGWATCH_LANE=" + lane
}

// EnvMap turns KEY=VALUE lines into a map, for callers that need to look a
// value up or render the set as an object rather than replay it into a child.
func EnvMap(lines []string) map[string]string {
	m := make(map[string]string, len(lines))
	for _, line := range lines {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		m[key] = value
	}
	return m
}
