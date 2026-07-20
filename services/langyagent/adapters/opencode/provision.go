package opencode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// ProvisionInput is everything Provision needs to lay down a worker's opencode
// home. Runner is the isolation seam (sandboxed chowns to the per-conversation
// UID; localUNSAFE no-ops).
type ProvisionInput struct {
	Home           string
	WorkspaceRoot  string // holds the materialized skills/ the worker home symlinks to
	Creds          domain.Credentials
	UID            uint32
	AgentsTemplate string
	Runner         app.Runner
	// EnableOpenTelemetry turns on opencode's NATIVE OTel export
	// (experimental.openTelemetry) in the generated config. Set when the manager
	// runs the loopback telemetry relay (adapters/otelrelay) the worker exports
	// to; the endpoint itself rides the env (see Mediation), never the config.
	// Unlike the removed external plugin, the native export bootstraps in ~0s.
	EnableOpenTelemetry bool
}

// Mediation is the loopback-relay wiring for a worker's spawn env
// (adapters/otelrelay): where the worker exports OTLP, and — phase 2 — where
// its LLM traffic goes so the manager can inject the virtual key + the turn's
// traceparent. The zero value means "unmediated": no OTel export, and the LLM
// virtual key goes directly into the worker env (the pre-relay wiring, kept as
// the fallback for a manager running without the relay).
type Mediation struct {
	// OTLPEndpoint is the worker's OTEL_EXPORTER_OTLP_ENDPOINT — a loopback
	// manager address scoped by a per-worker routing token. Deliberately carries
	// NO Authorization header: the manager holds the LangWatch key and
	// authenticates the forward itself.
	OTLPEndpoint string
	// LLMBaseURL replaces the AI gateway URL as the worker's OPENAI_BASE_URL.
	// When set, the LLM virtual key is NOT placed in the worker env — the
	// manager injects it on the proxied call instead.
	LLMBaseURL string
}

// SpawnInput is everything Spawn needs to start the opencode subprocess.
type SpawnInput struct {
	BinaryPath       string
	ConversationID   string
	Home             string
	UID              uint32
	Port             int
	Creds            domain.Credentials
	OpenCodePassword string
	EgressPort       int
	Runner           app.Runner
	// Mediation is the loopback-relay wiring (OTLP export + mediated LLM base
	// URL). Zero value ⇒ unmediated fallback.
	Mediation Mediation
	// Capabilities (GitHub today, a secrets broker next) each fold their own env
	// into the worker process — the env assembly never special-cases any one.
	Capabilities []app.Capability
}

// Provision creates a per-worker home dir with its own opencode config, a
// substituted AGENTS.md, and a symlink to the shared skills/ under WorkspaceRoot.
// Every file is chown'd (via the runner) to the per-conversation UID and chmod'd
// 0700/0600 BEFORE any credential material lands, so a sibling worker (running as
// a different UID) can never open(2) this worker's files even with knowledge of
// the path. The sandboxed runner requires CAP_CHOWN + CAP_DAC_OVERRIDE.
//
// The runner is the isolation seam: the sandboxed runner performs the chowns; the
// localUNSAFE runner no-ops them so the unprivileged dev manager can create these
// files as its own user (the chmods stay in both — chmod on files you own needs
// no privilege). Sibling isolation is gone under the local runner — acceptable
// ONLY on a single-tenant dev box.
func (a *Agent) Provision(in ProvisionInput) error {
	// Lock down the worker's home BEFORE writing anything sensitive.
	if err := in.Runner.Chown(in.Home, in.UID); err != nil {
		return fmt.Errorf("chown home: %w", err)
	}
	if err := os.Chmod(in.Home, 0o700); err != nil {
		return fmt.Errorf("chmod home: %w", err)
	}

	// Per-worker tmp dir. Without this, npm/git/opencode scratch lands in the
	// shared pod /tmp (world-writable, readable by all worker UIDs). Setting
	// TMPDIR to a 0700 subdirectory of the worker home puts the same
	// UID-enforced boundary on scratch files as on config.json.
	tmpDir := filepath.Join(in.Home, "tmp")
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		return fmt.Errorf("mkdir tmp: %w", err)
	}
	if err := in.Runner.Chown(tmpDir, in.UID); err != nil {
		return fmt.Errorf("chown tmp: %w", err)
	}

	configDir := filepath.Join(in.Home, ".config", "opencode")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return fmt.Errorf("mkdir config: %w", err)
	}
	// MkdirAll inherits the manager's UID (root). chown every newly created
	// intermediate so the worker UID owns the whole chain — anything left owned
	// by root with mode 0700 would EACCES the worker on traversal.
	for _, dir := range []string{
		filepath.Join(in.Home, ".config"),
		configDir,
	} {
		if err := in.Runner.Chown(dir, in.UID); err != nil {
			return fmt.Errorf("chown %s: %w", dir, err)
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return fmt.Errorf("chmod %s: %w", dir, err)
		}
	}

	model := in.Creds.Model
	if model == "" {
		model = "openai/gpt-5-mini"
	}

	// No "plugin" block. The worker previously loaded an external OpenTelemetry
	// plugin (@devtheops/opencode-plugin-otel), but evaluating that ~2 MB bundle
	// cost 15-25s of single-threaded work at first-message bootstrap — BEFORE the
	// first agent token — which overran the turn-liveness budget, so the turn was
	// killed and retried until it was abandoned (the user saw the title change and
	// "working"/"longer" cycle, then no response). It is pure observability (the
	// user's reply streams over the frame relay, never OTel), so it never belonged
	// on the turn's critical path. Worker telemetry returns host-mediated: the
	// worker will export OTLP to the manager over loopback (no LangWatch key in the
	// worker) and the manager re-parents those spans into the turn's trace before
	// forwarding them. Until that lands the worker runs without in-process
	// telemetry; the AI Gateway remains the source of truth for LLM-call
	// observability.

	// No "mcp" block. The worker reaches LangWatch through the `langwatch` CLI
	// and nothing else — that is the transport every skill is written against
	// (each skill's frontmatter says so outright: "the `langwatch` CLI is the
	// only interface"). Attaching the MCP server as a second transport injected
	// its whole tool-schema set into EVERY turn's context for capability the CLI
	// already has. The worker's credentials reach the CLI through the process env
	// (see buildWorkerEnv), not through a server config block.
	//
	// This is about what the AGENT consumes. The MCP server package itself is
	// untouched — it remains the customer-facing surface for Claude Desktop /
	// Cursor.
	config := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"model":   model,
		// Auto-allow every tool permission. opencode's permission model is an
		// INTERACTIVE prompt for a human at the TUI; a headless worker has no one to
		// answer it, so any tool whose permission defaults to "ask" (bash, edit,
		// external_directory, …) wedges the turn the instant it fires — the reply
		// just sits at "reconnecting" until the liveness sweep declares the worker
		// stopped. The worker's real boundary is the OS sandbox (per-worker UID,
		// the egress guard, read-only skills) plus the per-turn timeout, NOT a TUI
		// prompt, so "allow" is the only correct value here. It also silences the
		// dev-only "external_directory /*" ask: in a portless/haven stack the session
		// home lives under the user's ~, which opencode flags as external and asks
		// about on the very first file touch.
		"permission": "allow",
	}
	// opencode's NATIVE OTel export (traces + logs over standard
	// OTEL_EXPORTER_OTLP_* env). Bootstraps in ~0s — unlike the removed external
	// plugin — and points at the manager's loopback telemetry relay (see
	// Mediation.OTLPEndpoint in the spawn env), so no LangWatch key is needed or
	// present in the worker. Gated: with no relay there is no endpoint to export
	// to, and an enabled-but-endpointless SDK would retry into localhost:4318.
	if in.EnableOpenTelemetry {
		config["experimental"] = map[string]any{"openTelemetry": true}
	}
	// Surface the model's REASONING. Without a summary request, OpenAI's
	// Responses API bills the reasoning tokens but returns none of their
	// content, so opencode never emits a `reasoning` part and the panel's
	// thinking glimpse has nothing to show — a verified 4-5s per LLM call of
	// dead silence on gpt-5-mini. With it, opencode streams reasoning deltas
	// that ride the existing frames → relay → glimpse pipe end to end.
	if providerID, modelID, ok := strings.Cut(model, "/"); ok && providerID == "openai" {
		config["provider"] = map[string]any{
			"openai": map[string]any{
				"models": map[string]any{
					modelID: map[string]any{
						"options": map[string]any{"reasoningSummary": "auto"},
					},
				},
			},
		}
	}

	configPath := filepath.Join(configDir, "config.json")
	configBytes, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(configPath, configBytes, 0o600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	// WriteFile keeps ownership at the writing process (root). Explicit chown is
	// what makes "only the worker UID" literal — without it, the manager (root)
	// could still read the plaintext API key.
	if err := in.Runner.Chown(configPath, in.UID); err != nil {
		return fmt.Errorf("chown config: %w", err)
	}

	// Per-worker AGENTS.md with ${LANGWATCH_ENDPOINT} substituted. The embedded
	// AGENTS.md keeps the literal placeholder; we resolve it here so each worker
	// emits concrete URLs in its replies. The template bytes are read once at
	// Pool.New (from the embedded assets) — only the per-worker ReplaceAll happens
	// here, so a spawn no longer touches disk for AGENTS.md.
	if in.AgentsTemplate == "" {
		return fmt.Errorf("AGENTS.md template unavailable")
	}
	rendered := strings.ReplaceAll(in.AgentsTemplate, "${LANGWATCH_ENDPOINT}", in.Creds.LangwatchEndpoint)
	agentsPath := filepath.Join(in.Home, "AGENTS.md")
	if err := os.WriteFile(agentsPath, []byte(rendered), 0o600); err != nil {
		return fmt.Errorf("write AGENTS.md: %w", err)
	}
	if err := in.Runner.Chown(agentsPath, in.UID); err != nil {
		return fmt.Errorf("chown AGENTS.md: %w", err)
	}

	// Symlink opencode's skills directory to the shared template directory.
	// opencode discovers global skills under $HOME/.config/opencode/skills,
	// where each <name>/SKILL.md is exposed to the model as an invokable skill —
	// so the link MUST land there, not at $HOME/skills (which opencode never
	// scans). The shared dir is root-owned and world-readable (materialized from
	// the embedded assets by workerpool.New), so workers following the link can
	// READ but not mutate it.
	skillsLink := skillsDir(in.Home)
	if err := os.Symlink(filepath.Join(in.WorkspaceRoot, "skills"), skillsLink); err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("symlink skills: %w", err)
	}
	// lchown the symlink itself; target permissions are what actually gate reads
	// but lchowning prevents another UID from tampering with the link.
	_ = in.Runner.Lchown(skillsLink, in.UID)

	return nil
}

// Spawn starts the opencode subprocess with the per-worker env and drops into the
// per-conversation UID before exec via the runner's SysProcAttr (the sandboxed
// runner setuids into the UID; the localUNSAFE runner runs as the manager's own
// user). Combined with mode 0700 on the home and mode 0600 on config.json, the UID
// handoff makes a sibling worker's files unreachable to this process at the kernel
// level — open(2) returns EACCES regardless of how the path is constructed.
//
// ctx is the POOL-LIFETIME context (not a single request's): the worker outlives
// the turn that spawned it and only dies on idle/shutdown, but binding to the pool
// context means a pool Shutdown / deadline still propagates to the subprocess.
func (a *Agent) Spawn(ctx context.Context, in SpawnInput) (*exec.Cmd, error) {
	cmd := in.Runner.CommandContext(ctx, in.BinaryPath,
		"serve", "--port", strconv.Itoa(in.Port), "--hostname", "127.0.0.1",
	)
	cmd.Env = buildWorkerEnv(in.ConversationID, in.Home, in.Creds, in.OpenCodePassword, in.EgressPort, in.Mediation, in.Capabilities)
	cmd.Dir = in.Home
	// Discard opencode's stdout/stderr. opencode emits LLM completions, tool
	// outputs (env dumps, file contents), and the raw user prompt — all of which
	// are the highest-density PII/secret surface in the worker. The auditable
	// telemetry channel is the loopback OTel relay (adapters/otelrelay): the
	// worker's OTLP spans are reparented onto the turn's trace and forwarded
	// to the user's LangWatch project. Pod stdout/stderr lands in cluster log
	// storage with no per-conversation TTL and no redaction, so piping the
	// same bytes there would re-leak everything OTel already structures.
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	cmd.SysProcAttr = in.Runner.SysProcAttr(in.UID)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start opencode: %w", err)
	}
	return cmd, nil
}

// skillsDir is the directory opencode scans for a worker's skills:
// $HOME/.config/opencode/skills. Each <name>/SKILL.md beneath it is discovered at
// startup and exposed to the model as an invokable skill. Kept as one helper so
// the provision path and its test agree on exactly where skills must land.
func skillsDir(workerHome string) string {
	return filepath.Join(workerHome, ".config", "opencode", "skills")
}

// workerInheritedEnvKeys is the complete set of manager environment variables
// a worker may inherit. Everything security-sensitive is injected explicitly
// below from the turn's scoped Credentials/Capabilities instead of relying on
// naming conventions. An allowlist means a newly introduced manager secret is
// private by default, regardless of its name.
var workerInheritedEnvKeys = []string{
	"PATH",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"TERM",
	"COLORTERM",
	"NO_COLOR",
	"FORCE_COLOR",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
}

func workerBaseEnv() []string {
	out := make([]string, 0, len(workerInheritedEnvKeys))
	for _, key := range workerInheritedEnvKeys {
		if value, ok := os.LookupEnv(key); ok {
			out = append(out, key+"="+value)
		}
	}
	return out
}

// mediatedLLMPlaceholderKey is what a mediated worker sends as its OpenAI API
// key. NOT a credential: the manager's LLM relay replaces the Authorization
// header with the real virtual key on the forward. It exists only because the
// OpenAI SDK refuses an empty key.
const mediatedLLMPlaceholderKey = "langy-mediated"

// buildWorkerEnv assembles the environment for a worker's opencode subprocess:
// the allowlisted inherited env plus per-worker credentials and the per-worker
// OPENCODE_SERVER_PASSWORD. Pure and side-effect free — factored out of Spawn so
// it's unit-testable without spawning a real subprocess.
//
// egressPort is the loopback port of THIS worker's egress adapter (ADR-043),
// 0 when the guard runs no proxy. When set, it is injected as HTTPS_PROXY/
// HTTP_PROXY so the worker's tools (`gh`, `git`, `npm`, `curl`, `pip`) egress
// THROUGH the adapter, which enforces the require-TLS / throttle / allow-list /
// FQDN-floor rungs. The in-cluster control-plane + gateway hosts and loopback
// are put in NO_PROXY so the `langwatch` CLI's LangWatch-API calls and opencode's
// LLM traffic go direct (they have their own explicit NetworkPolicy egress
// rules; routing them through the per-worker proxy would add a hop and expose
// LLM streaming to the throttle).
func buildWorkerEnv(conversationID, workerHome string, creds domain.Credentials, openCodePassword string, egressPort int, med Mediation, caps []app.Capability) []string {
	env := workerBaseEnv()

	// LLM wiring. Mediated (phase 2): OPENAI_BASE_URL points at the manager's
	// loopback relay, which injects the REAL virtual key + the turn's traceparent
	// on the forward — so the virtual key never enters the model-driven worker
	// env; the worker sends only a non-credential placeholder (the OpenAI SDK
	// refuses an empty key). Unmediated fallback: the pre-relay wiring, VK direct.
	llmBaseURL, llmKey := creds.GatewayBaseURL, creds.LLMVirtualKey
	if med.LLMBaseURL != "" {
		llmBaseURL, llmKey = med.LLMBaseURL, mediatedLLMPlaceholderKey
	}

	env = append(env,
		"HOME="+workerHome,
		"TMPDIR="+filepath.Join(workerHome, "tmp"),
		"OPENAI_BASE_URL="+llmBaseURL,
		"OPENAI_API_KEY="+llmKey,
		// LANGWATCH_API_KEY stays in the worker env DELIBERATELY: the `langwatch`
		// CLI — the worker's only LangWatch transport (see Provision's no-MCP
		// stance) — authenticates every trace-search/dataset/etc. call with it
		// against LANGWATCH_ENDPOINT. Mediating the CLI would mean reverse-proxying
		// the entire LangWatch REST surface; not worth it while the key is already
		// a short-lived, revocable, per-conversation session key. The key the
		// mediation DOES remove from the worker is the OTLP-export credential (none
		// below) and the LLM virtual key (above).
		"LANGWATCH_API_KEY="+creds.LangwatchAPIKey,
		"LANGWATCH_ENDPOINT="+creds.LangwatchEndpoint,
		// Requires opencode's HTTP control server to authenticate with HTTP
		// Basic (user "opencode", this password) instead of serving every
		// request unauthenticated. This is the sibling-isolation guarantee
		// (ADR-033 Fix A′): env-injected, not a CLI flag, so it never lands in
		// the world-readable /proc/<pid>/cmdline — only in /proc/<pid>/environ,
		// which is 0400 and UID-gated.
		"OPENCODE_SERVER_PASSWORD="+openCodePassword,
	)
	// Host-mediated worker telemetry (phase 1): opencode's native OTel export
	// points at the manager's loopback relay. NO authorization header — the
	// endpoint's per-worker routing token scopes the submission and the manager
	// holds the LangWatch key for the forward. Absent when no relay runs.
	if med.OTLPEndpoint != "" {
		env = append(env,
			"OTEL_EXPORTER_OTLP_ENDPOINT="+med.OTLPEndpoint,
			"OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf",
			"OTEL_SERVICE_NAME=langwatch-service-langyworker",
		)
	}
	// Capabilities (GitHub today) fold their own env in — GH_TOKEN + GITHUB_LOGIN
	// used to be an inline branch here; it is now the github.Capability's
	// Contribute(). buildWorkerEnv no longer knows about any specific capability.
	for _, c := range caps {
		env = append(env, c.Contribute()...)
	}
	if egressPort > 0 {
		proxyURL := fmt.Sprintf("http://127.0.0.1:%d", egressPort)
		noProxy := noProxyHosts(creds)
		env = append(env,
			// Lower- and upper-case both: `gh`/`git`/`curl` read the lower-case
			// forms, some Go/Node tooling the upper-case ones.
			"HTTPS_PROXY="+proxyURL,
			"https_proxy="+proxyURL,
			"HTTP_PROXY="+proxyURL,
			"http_proxy="+proxyURL,
			"NO_PROXY="+noProxy,
			"no_proxy="+noProxy,
		)
	}
	// NODE_EXTRA_CA_CERTS is forwarded EXPLICITLY rather than left to the
	// inherited-env filter above: opencode runs on Bun, which trusts only its own
	// bundled CA roots plus this var — never the macOS system store. In portless
	// dev haven points it at the portless Local CA (see haven's planChildren) so
	// the worker's HTTPS calls to the gateway/control-plane hostnames succeed;
	// without it every model call dies with "self signed certificate in
	// certificate chain". Dev-only: real deployments serve real certs, so the var
	// is unset and this contributes nothing.
	if ca := os.Getenv("NODE_EXTRA_CA_CERTS"); ca != "" {
		env = append(env, "NODE_EXTRA_CA_CERTS="+ca)
	}
	return env
}

// noProxyHosts is the NO_PROXY list for a worker: loopback plus the in-cluster
// control-plane and gateway hosts, which egress via their own explicit
// NetworkPolicy rules and must NOT be funnelled through the per-worker egress
// adapter (ADR-043: "loopback and the in-cluster control-plane/gateway paths
// are unaffected").
func noProxyHosts(creds domain.Credentials) string {
	hosts := []string{"127.0.0.1", "localhost", "::1"}
	seen := map[string]struct{}{"127.0.0.1": {}, "localhost": {}, "::1": {}}
	for _, raw := range []string{creds.LangwatchEndpoint, creds.GatewayBaseURL} {
		h := hostFromURL(raw)
		if h == "" {
			continue
		}
		if _, dup := seen[h]; dup {
			continue
		}
		seen[h] = struct{}{}
		hosts = append(hosts, h)
	}
	return strings.Join(hosts, ",")
}

// hostFromURL extracts the bare hostname from a URL, tolerating a value with no
// scheme. Returns "" when nothing host-like can be parsed.
func hostFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "//" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
