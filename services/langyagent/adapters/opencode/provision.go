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
	"regexp"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// ProvisionInput is everything Provision needs to lay down a worker's opencode
// home. Runner is the isolation seam (sandboxed chowns to the per-conversation
// UID; localUNSAFE no-ops).
type ProvisionInput struct {
	Home              string
	WorkspaceRoot     string // holds the materialized skills/ the worker home symlinks to
	Creds             domain.Credentials
	UID               uint32
	OTelPluginVersion string
	AgentsTemplate    string
	Runner            app.Runner
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

	plugin := fmt.Sprintf("@devtheops/opencode-plugin-otel@%s", in.OTelPluginVersion)

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
		"plugin":  []string{plugin},
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
	cmd := exec.CommandContext(ctx, in.BinaryPath,
		"serve", "--port", strconv.Itoa(in.Port), "--hostname", "127.0.0.1",
	)
	cmd.Env = buildWorkerEnv(in.ConversationID, in.Home, in.Creds, in.OpenCodePassword, in.EgressPort, in.Capabilities)
	cmd.Dir = in.Home
	// Discard opencode's stdout/stderr. opencode emits LLM completions, tool
	// outputs (env dumps, file contents), and the raw user prompt — all of which
	// are the highest-density PII/secret surface in the worker. The OpenCode
	// OTel plugin already exports structured spans (gen_ai.usage, tool spans)
	// into the user's LangWatch project — that's the auditable telemetry
	// channel. Pod stdout/stderr lands in cluster log storage with no
	// per-conversation TTL and no redaction, so piping the same bytes there
	// would re-leak everything OTel already structures.
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

// sensitiveEnvPattern matches env names that must never reach a worker. The JS
// manager listed these by name; the Go version mirrors that policy and extends
// it with two suffix classes so arbitrary provider keys inherited from a
// local-dev .env (OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY,
// API_TOKEN_JWT_SECRET, ...) cannot reach a per-conversation OpenCode
// subprocess. The worker still receives its own llmVirtualKey + langwatch API
// key via Credentials.* — those are written into the env explicitly after this
// filter, so blocking the inherited variants is the desired posture (only the
// per-project Langy VK reaches the model, never the human's personal provider
// key).
//
// This stays a DENYLIST for compatibility. ACKNOWLEDGED SUFFIX-GAP (ADR-047,
// left as a comment ONLY — not widened in this PR): a denylist can never be
// exhaustive; a var like `MY_APIKEY` (no separator before KEY) or a novel
// secret prefix slips through. A true ALLOWLIST (PATH, HOME, LANG, USER, TZ +
// the OTEL_/LANGY_/OPENCODE_ vars actually needed) is the more secure
// long-term shape but requires testing every var an OpenCode subprocess might
// legitimately read. Add new prefixes here when introducing manager-only
// secrets; the allowlist migration is tracked separately.
var sensitiveEnvPattern = regexp.MustCompile(
	`^(LANGY_INTERNAL_SECRET$|GITHUB_LANGY_|CREDENTIALS_SECRET$|NEXTAUTH_|DATABASE_URL$|AWS_SECRET_|LW_GATEWAY_|LW_VIRTUAL_KEY_)` +
		// `AWS_ACCESS_KEY_ID` ends in `_ID`, NOT `_KEY` — the suffix rules below
		// would miss it. Anchor an explicit literal so the access-key half of an
		// AWS credential pair can't leak.
		`|^AWS_ACCESS_KEY_ID$` +
		`|_(API_)?KEY$` +
		`|_SECRET(_|$)` +
		// `_TOKEN(_|$)` catches `GH_TOKEN`, `GITHUB_TOKEN`, `API_TOKEN_*`, etc. —
		// the worker still receives an explicit `GH_TOKEN=` from buildWorkerEnv
		// AFTER this filter, so blocking the inherited variant is correct (it
		// would shadow the per-conversation creds otherwise). `_PASSWORD(_|$)`
		// catches `POSTGRES_PASSWORD`/`REDIS_PASSWORD` and anything else an
		// `envFrom: secretRef` mounts under that convention.
		`|_TOKEN(_|$)` +
		`|_PASSWORD(_|$)` +
		// `_URL$` / `_URI$` block credential-bearing connection strings
		// (`REDIS_URL=redis://user:pass@host:6379/0`, `POSTGRES_URL`,
		// `MONGODB_URI`, `CLICKHOUSE_URL`, ...). The worker runs model-driven
		// shell with HTTPS egress, so a prompt-injected turn could otherwise
		// `env | grep -iE 'redis|postgres'` and exfiltrate the password embedded
		// in the URL userinfo. `_DSN$` covers `SENTRY_DSN` and similar telemetry
		// creds (DSNs embed the project key in the URL).
		`|_URL$` +
		`|_URI$` +
		`|_DSN$`,
)

// filterSensitiveEnv returns the process env minus anything matching
// sensitiveEnvPattern. The worker gets its own credentials injected explicitly
// after this filter.
func filterSensitiveEnv() []string {
	env := os.Environ()
	out := make([]string, 0, len(env))
	for _, kv := range env {
		eq := strings.IndexByte(kv, '=')
		if eq < 0 {
			continue
		}
		if sensitiveEnvPattern.MatchString(kv[:eq]) {
			continue
		}
		out = append(out, kv)
	}
	return out
}

// buildWorkerEnv assembles the environment for a worker's opencode subprocess:
// the filtered inherited env plus per-worker credentials and the per-worker
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
func buildWorkerEnv(conversationID, workerHome string, creds domain.Credentials, openCodePassword string, egressPort int, caps []app.Capability) []string {
	env := filterSensitiveEnv()
	env = append(env,
		"HOME="+workerHome,
		"TMPDIR="+filepath.Join(workerHome, "tmp"),
		"OPENAI_BASE_URL="+creds.GatewayBaseURL,
		"OPENAI_API_KEY="+creds.LLMVirtualKey,
		"LANGWATCH_API_KEY="+creds.LangwatchAPIKey,
		"LANGWATCH_ENDPOINT="+creds.LangwatchEndpoint,
		// OpenCode OTel plugin: opencode auto-loads it by name; the plugin reads
		// OPENCODE_OTLP_* and exports gen_ai.usage.* spans into the user's
		// LangWatch project. The OTel endpoint appends /v1/traces so we hand it
		// the /api/otel base.
		"OPENCODE_ENABLE_TELEMETRY=1",
		"OPENCODE_OTLP_ENDPOINT="+strings.TrimRight(creds.LangwatchEndpoint, "/")+"/api/otel",
		"OPENCODE_OTLP_PROTOCOL=http/protobuf",
		"OPENCODE_OTLP_HEADERS=Authorization=Bearer "+creds.LangwatchAPIKey,
		"OPENCODE_RESOURCE_ATTRIBUTES=tag.tags=langy,service.name=langyagent,langwatch.thread.id="+conversationID,
		// Requires opencode's HTTP control server to authenticate with HTTP
		// Basic (user "opencode", this password) instead of serving every
		// request unauthenticated. This is the sibling-isolation guarantee
		// (ADR-033 Fix A′): env-injected, not a CLI flag, so it never lands in
		// the world-readable /proc/<pid>/cmdline — only in /proc/<pid>/environ,
		// which is 0400 and UID-gated.
		"OPENCODE_SERVER_PASSWORD="+openCodePassword,
	)
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
