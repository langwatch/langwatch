package opencode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/localunsafe"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/workerenv"
)

// A stand-in for the embedded AGENTS.md. It carries no placeholder, because
// the provision renders nothing into the template: whatever is in the prompt
// can reach the user in a reply.
const agentsTemplateFixture = "# AGENTS\nOperating contract.\n"

// The prompt used to be rendered per worker, which put the worker's own
// endpoint into the one paragraph that forbids giving the user internal
// addresses. The substitution is gone, so the template must arrive intact.
//
// @scenario "The prompt reaches the worker exactly as it was written"
func TestProvision_WritesTheAgentsTemplateUnchanged(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "skills"), 0o755); err != nil {
		t.Fatalf("mkdir shared skills: %v", err)
	}
	err := NewAgent(0).Provision(ProvisionInput{
		Home:          home,
		WorkspaceRoot: workspace,
		Creds: domain.Credentials{
			LangwatchAPIKey:   "sk-lw-test-key",
			LLMVirtualKey:     "vk-test",
			GatewayBaseURL:    "https://gateway.test",
			LangwatchEndpoint: "https://app.test",
		},
		UID:            0,
		AgentsTemplate: agentsTemplateFixture,
		Runner:         localunsafe.Runner{},
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(home, "AGENTS.md"))
	if err != nil {
		t.Fatalf("read AGENTS.md: %v", err)
	}
	if string(got) != agentsTemplateFixture {
		t.Errorf("AGENTS.md = %q, want the template written through unchanged (%q)", got, agentsTemplateFixture)
	}
}

func TestWorkerBaseEnv_AllowsOnlyExplicitKeys(t *testing.T) {
	for k, v := range map[string]string{
		"LANGY_INTERNAL_SECRET": "must-not-leak",
		"GITHUB_LANGY_APP_ID":   "must-not-leak",
		"CREDENTIALS_SECRET":    "must-not-leak",
		"NEXTAUTH_URL":          "must-not-leak",
		"NEXTAUTH_SECRET":       "must-not-leak",
		"DATABASE_URL":          "must-not-leak",
		"AWS_SECRET_ACCESS_KEY": "must-not-leak",
		// Suffix patterns: any *_API_KEY / *_KEY / *_SECRET inherited from a
		// local-dev .env must not reach the worker.
		"OPENAI_API_KEY":             "must-not-leak",
		"ANTHROPIC_API_KEY":          "must-not-leak",
		"GROQ_API_KEY":               "must-not-leak",
		"AZURE_OPENAI_API_KEY":       "must-not-leak",
		"SENDGRID_API_KEY":           "must-not-leak",
		"API_TOKEN_JWT_SECRET":       "must-not-leak",
		"LW_GATEWAY_INTERNAL_SECRET": "must-not-leak",
		"LW_GATEWAY_JWT_SECRET":      "must-not-leak",
		"LW_VIRTUAL_KEY_PEPPER":      "must-not-leak",
		// Credential-bearing connection strings, DSNs, and the AWS_ACCESS_KEY_ID
		// half (ends in _ID, not _KEY, so the suffix block needs an explicit
		// literal).
		"REDIS_URL":         "redis://user:secret@host:6379/0",
		"POSTGRES_URL":      "postgres://user:secret@host:5432/db",
		"CLICKHOUSE_URL":    "https://user:secret@host:8443/db",
		"MONGODB_URI":       "mongodb://user:secret@host:27017/db",
		"SENTRY_DSN":        "https://abc123@o123.ingest.sentry.io/456",
		"AWS_ACCESS_KEY_ID": "AKIA_must_not_leak",
		"GH_TOKEN":          "ghp_inherited_must_not_leak",
		"GITHUB_TOKEN":      "ghp_ci_token_must_not_leak",
		"POSTGRES_PASSWORD": "must-not-leak",
		// A novel secret-looking name and innocuous manager tuning are both
		// absent: inheritance is allowlisted, not classified by name.
		"MY_APIKEY":         "must-not-leak",
		"LANGY_MAX_WORKERS": "must-not-leak",
		"HOME":              "must-not-leak",
		// PASS-THROUGH cases.
		"PATH": "/safe/bin",
		"LANG": "C.UTF-8",
	} {
		t.Setenv(k, v)
	}

	env := workerenv.BaseEnv()

	mustBeAbsent := []string{
		"LANGY_INTERNAL_SECRET=",
		"GITHUB_LANGY_APP_ID=",
		"CREDENTIALS_SECRET=",
		"NEXTAUTH_URL=",
		"NEXTAUTH_SECRET=",
		"DATABASE_URL=",
		"AWS_SECRET_ACCESS_KEY=",
		"OPENAI_API_KEY=",
		"ANTHROPIC_API_KEY=",
		"GROQ_API_KEY=",
		"AZURE_OPENAI_API_KEY=",
		"SENDGRID_API_KEY=",
		"API_TOKEN_JWT_SECRET=",
		"LW_GATEWAY_INTERNAL_SECRET=",
		"LW_GATEWAY_JWT_SECRET=",
		"LW_VIRTUAL_KEY_PEPPER=",
		"REDIS_URL=",
		"POSTGRES_URL=",
		"CLICKHOUSE_URL=",
		"MONGODB_URI=",
		"SENTRY_DSN=",
		"AWS_ACCESS_KEY_ID=",
		"GH_TOKEN=",
		"GITHUB_TOKEN=",
		"POSTGRES_PASSWORD=",
		"MY_APIKEY=",
		"LANGY_MAX_WORKERS=",
		"HOME=",
	}
	for _, prefix := range mustBeAbsent {
		for _, kv := range env {
			if strings.HasPrefix(kv, prefix) {
				t.Errorf("env still contains %s (full: %q)", prefix, kv)
			}
		}
	}

	mustBePresent := []string{"PATH=/safe/bin", "LANG=C.UTF-8"}
	for _, want := range mustBePresent {
		found := false
		for _, kv := range env {
			if kv == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("env missing expected entry %q", want)
		}
	}

	allowed := make(map[string]bool, len(workerenv.InheritedEnvKeys))
	for _, key := range workerenv.InheritedEnvKeys {
		allowed[key] = true
	}
	for _, kv := range env {
		key, _, _ := strings.Cut(kv, "=")
		if !allowed[key] {
			t.Fatalf("workerenv.BaseEnv inherited non-allowlisted key %q", key)
		}
	}
}

// buildWorkerEnv must inject a distinct OPENCODE_SERVER_PASSWORD per worker. A
// shared password would mean worker A's authProxy credential also unlocks
// worker B's opencode — the exact hole Fix A′ (ADR-033) closes.
func TestBuildWorkerEnv_InjectsUniqueOpenCodePassword(t *testing.T) {
	creds := domain.Credentials{
		LangwatchAPIKey:   "lw-key",
		GatewayBaseURL:    "https://gateway.internal",
		LangwatchEndpoint: "https://app.langwatch.ai",
	}

	pwA, err := GenerateBearerToken()
	if err != nil {
		t.Fatalf("GenerateBearerToken: %v", err)
	}
	pwB, err := GenerateBearerToken()
	if err != nil {
		t.Fatalf("GenerateBearerToken: %v", err)
	}

	envA := buildWorkerEnv("/workspace/sessions/conv-a", "conv-a", creds, pwA, 19001, Mediation{}, nil)
	envB := buildWorkerEnv("/workspace/sessions/conv-b", "conv-b", creds, pwB, 19002, Mediation{}, nil)

	if got := valueOfEnv(envA, "OPENCODE_SERVER_PASSWORD"); got != pwA {
		t.Fatalf("worker A env OPENCODE_SERVER_PASSWORD = %q, want %q", got, pwA)
	}
	if got := valueOfEnv(envB, "OPENCODE_SERVER_PASSWORD"); got != pwB {
		t.Fatalf("worker B env OPENCODE_SERVER_PASSWORD = %q, want %q", got, pwB)
	}
	if pwA == pwB {
		t.Fatalf("two workers must not share an OPENCODE_SERVER_PASSWORD")
	}
}

// opencode folds every skill it discovers into the system prompt, and two of
// its scan roots (~/.claude/skills, ~/.agents/skills) resolve the real account
// home rather than the worker's HOME. On a host-tier manager that puts the
// operator's own skills in front of Langy: measured on a dev box, 17 of them,
// 8,191 characters, 22% of the assembled system message, including a skill
// that brokers Slack and Gmail credentials. Langy runs the skills we ship it.
//
// @scenario "The worker runs only the skills we ship it"
func TestBuildWorkerEnv_DisablesExternalSkillScans(t *testing.T) {
	env := buildWorkerEnv(
		"/workspace/sessions/conv-a",
		"conv-a",
		domain.Credentials{LangwatchAPIKey: "lw-key"},
		"pw",
		19001,
		Mediation{},
		nil,
	)

	for _, key := range []string{
		"OPENCODE_DISABLE_EXTERNAL_SKILLS",
		"OPENCODE_DISABLE_CLAUDE_CODE_SKILLS",
	} {
		if got := valueOfEnv(env, key); got != "1" {
			t.Errorf("worker env %s = %q, want %q", key, got, "1")
		}
	}
}

// buildWorkerEnv must inject the per-worker credentials. It must NOT hand the
// worker any OTLP telemetry key/endpoint — the OTel plugin was removed (its
// module-load cost killed turns) and worker telemetry returns host-mediated, so
// the LangWatch key stays on the host. GitHub env is NOT its job either — that
// is a Capability's Contribute() (see adapters/github +
// TestBuildWorkerEnv_AppendsCapabilityEnv).
func TestBuildWorkerEnv_InjectsCredentials(t *testing.T) {
	creds := domain.Credentials{
		LangwatchAPIKey:   "lw-key",
		LLMVirtualKey:     "vk-secret",
		GatewayBaseURL:    "https://gateway.internal/v1",
		LangwatchEndpoint: "https://app.langwatch.ai",
	}
	env := buildWorkerEnv("/workspace/sessions/conv-x", "conv-x", creds, "pw", 0, Mediation{}, nil)

	wants := map[string]string{
		"OPENAI_BASE_URL":    "https://gateway.internal/v1",
		"OPENAI_API_KEY":     "vk-secret",
		"LANGWATCH_API_KEY":  "lw-key",
		"LANGWATCH_ENDPOINT": "https://app.langwatch.ai",
	}
	for k, v := range wants {
		if got := valueOfEnv(env, k); got != v {
			t.Errorf("env[%s] = %q, want %q", k, got, v)
		}
	}
	// The worker must receive NO OTLP telemetry key/endpoint: telemetry is
	// host-mediated, so the LangWatch key never enters the worker env.
	for _, k := range []string{
		"OPENCODE_OTLP_ENDPOINT", "OPENCODE_OTLP_HEADERS", "OPENCODE_OTLP_PROTOCOL",
		"OPENCODE_ENABLE_TELEMETRY", "OPENCODE_RESOURCE_ATTRIBUTES",
	} {
		if got := valueOfEnv(env, k); got != "" {
			t.Errorf("worker env must not contain %s (host-mediated telemetry keeps the key on the host); got %q", k, got)
		}
	}
	if valueOfEnv(env, "GH_TOKEN") != "" {
		t.Errorf("buildWorkerEnv must not inject GH_TOKEN itself — that is a capability's Contribute()")
	}
}

// With mediation wired (the manager's loopback relay), the worker env must hold
// NO customer secret for telemetry or LLM traffic: the OTLP endpoint is a
// token-scoped loopback URL with NO authorization header, and the LLM base URL
// is the relay with only a placeholder key — the virtual key must appear
// NOWHERE in the env. LANGWATCH_API_KEY remains, deliberately: the `langwatch`
// CLI (the worker's only LangWatch transport) authenticates with it.
func TestBuildWorkerEnv_MediatedTelemetryAndLLMCarryNoSecrets(t *testing.T) {
	creds := domain.Credentials{
		LangwatchAPIKey:   "lw-session-key",
		LLMVirtualKey:     "vk-super-secret",
		GatewayBaseURL:    "https://gateway.internal/openai/v1",
		LangwatchEndpoint: "https://app.langwatch.ai",
	}
	med := Mediation{
		OTLPEndpoint: "http://127.0.0.1:41000/w/tok123",
		LLMBaseURL:   "http://127.0.0.1:41000/w/tok123/llm",
	}
	env := buildWorkerEnv("/workspace/sessions/conv-x", "conv-x", creds, "pw", 0, med, nil)

	wants := map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": med.OTLPEndpoint,
		"OTEL_EXPORTER_OTLP_PROTOCOL": "http/protobuf",
		"OTEL_SERVICE_NAME":           "langwatch-service-langyworker",
		"OPENAI_BASE_URL":             med.LLMBaseURL,
		"OPENAI_API_KEY":              mediatedLLMPlaceholderKey,
		"LANGWATCH_API_KEY":           "lw-session-key",
	}
	for k, v := range wants {
		if got := valueOfEnv(env, k); got != v {
			t.Errorf("env[%s] = %q, want %q", k, got, v)
		}
	}
	// No OTLP auth header var of any kind: the endpoint's routing token is the
	// only scoping, and the manager holds the key for the forward.
	if got := valueOfEnv(env, "OTEL_EXPORTER_OTLP_HEADERS"); got != "" {
		t.Errorf("worker env must carry no OTLP headers (no auth in the worker); got %q", got)
	}
	// The virtual key must appear NOWHERE in the mediated worker env.
	for _, kv := range env {
		if strings.Contains(kv, creds.LLMVirtualKey) {
			t.Errorf("mediated worker env leaks the LLM virtual key: %q", kv)
		}
	}
	// The session key appears ONLY as LANGWATCH_API_KEY (the CLI's credential),
	// never in any telemetry/LLM var.
	for _, kv := range env {
		if strings.Contains(kv, creds.LangwatchAPIKey) && !strings.HasPrefix(kv, "LANGWATCH_API_KEY=") {
			t.Errorf("session key leaked outside LANGWATCH_API_KEY: %q", kv)
		}
	}
}

// Without mediation (nil relay: tests, partial wiring) the env falls back to
// the direct wiring — VK to the gateway, no OTel export vars at all.
func TestBuildWorkerEnv_UnmediatedFallback(t *testing.T) {
	creds := domain.Credentials{
		LangwatchAPIKey:   "lw-key",
		LLMVirtualKey:     "vk-secret",
		GatewayBaseURL:    "https://gateway.internal/v1",
		LangwatchEndpoint: "https://app.langwatch.ai",
	}
	env := buildWorkerEnv("/workspace/sessions/conv-x", "conv-x", creds, "pw", 0, Mediation{}, nil)
	if got := valueOfEnv(env, "OPENAI_BASE_URL"); got != creds.GatewayBaseURL {
		t.Errorf("OPENAI_BASE_URL = %q, want direct gateway %q", got, creds.GatewayBaseURL)
	}
	if got := valueOfEnv(env, "OPENAI_API_KEY"); got != creds.LLMVirtualKey {
		t.Errorf("OPENAI_API_KEY = %q, want the virtual key (unmediated fallback)", got)
	}
	for _, k := range []string{"OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_PROTOCOL", "OTEL_SERVICE_NAME"} {
		if got := valueOfEnv(env, k); got != "" {
			t.Errorf("unmediated env must carry no %s; got %q", k, got)
		}
	}
}

// fakeCap is a stand-in app.Capability that contributes arbitrary env, so the
// buildWorkerEnv test can prove it folds capabilities in without depending on any
// concrete one (GitHub is tested in adapters/github).
type fakeCap struct{ env []string }

func (fakeCap) Name() string           { return "fake" }
func (c fakeCap) Contribute() []string { return c.env }
func (fakeCap) SignatureKey() string   { return "fake" }

// buildWorkerEnv folds each capability's Contribute() into the worker env, without
// knowing what any capability is.
func TestBuildWorkerEnv_AppendsCapabilityEnv(t *testing.T) {
	creds := domain.Credentials{
		LangwatchAPIKey:   "lw-key",
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "https://gateway.internal/v1",
		LangwatchEndpoint: "https://app.langwatch.ai",
	}
	caps := []app.Capability{fakeCap{env: []string{"CAP_A=1", "CAP_B=2"}}}
	env := buildWorkerEnv("/workspace/sessions/conv-x", "conv-x", creds, "pw", 0, Mediation{}, caps)
	if valueOfEnv(env, "CAP_A") != "1" || valueOfEnv(env, "CAP_B") != "2" {
		t.Errorf("capability env not folded into the worker env: %v", env)
	}
}

// buildWorkerEnv must point the worker's HTTPS_PROXY at the per-worker egress
// adapter (ADR-076) when an egress port is set, and must NO_PROXY the loopback +
// in-cluster control-plane / gateway hosts so their traffic goes direct rather
// than through the throttled per-worker proxy. With no egress port, no proxy env
// is injected (the worker egresses direct, as before).
func TestBuildWorkerEnv_InjectsEgressProxy(t *testing.T) {
	creds := domain.Credentials{
		LangwatchAPIKey:   "lw-key",
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "https://gateway.internal/v1",
		LangwatchEndpoint: "https://app.langwatch.ai",
	}

	env := buildWorkerEnv("/workspace/sessions/conv-x", "conv-x", creds, "pw", 19555, Mediation{}, nil)
	wantProxy := "http://127.0.0.1:19555"
	for _, key := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"} {
		if got := valueOfEnv(env, key); got != wantProxy {
			t.Errorf("env[%s] = %q, want %q", key, got, wantProxy)
		}
	}
	noProxy := valueOfEnv(env, "NO_PROXY")
	for _, host := range []string{"127.0.0.1", "localhost", "app.langwatch.ai", "gateway.internal"} {
		if !strings.Contains(noProxy, host) {
			t.Errorf("NO_PROXY %q missing in-cluster/loopback host %q", noProxy, host)
		}
	}
	if valueOfEnv(env, "no_proxy") != noProxy {
		t.Errorf("no_proxy must mirror NO_PROXY")
	}

	// No egress port ⇒ no proxy env at all.
	direct := buildWorkerEnv("/workspace/sessions/conv-x", "conv-x", creds, "pw", 0, Mediation{}, nil)
	if got := valueOfEnv(direct, "HTTPS_PROXY"); got != "" {
		t.Errorf("HTTPS_PROXY must be absent when no egress port is set, got %q", got)
	}
}

func valueOfEnv(env []string, key string) string {
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return strings.TrimPrefix(e, prefix)
		}
	}
	return ""
}

func TestSkillsDir_UnderOpenCodeConfig(t *testing.T) {
	// opencode only discovers global skills under $HOME/.config/opencode/skills.
	home := "/home/worker-123"
	got := skillsDir(home)
	want := filepath.Join(home, ".config", "opencode", "skills")
	if got != want {
		t.Fatalf("skillsDir = %q, want %q", got, want)
	}
}

// The worker's opencode config.json decides which LangWatch transport the agent
// gets. It is the `langwatch` CLI and nothing else: no MCP server, ever. This
// pins that — a config.json carrying an "mcp" key would re-inject the whole
// tool-schema set into every turn's context for capability the CLI already has,
// and would put a second, divergent transport in front of skills that are written
// against the CLI alone.
//
// The skills symlink is asserted alongside it: with MCP gone, skills + CLI ARE
// the capability surface, so a silently-missing symlink is a total loss of it.
func TestProvision_WritesCLIOnlyConfig(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "skills"), 0o755); err != nil {
		t.Fatalf("mkdir shared skills: %v", err)
	}

	creds := domain.Credentials{
		LangwatchAPIKey:   "sk-lw-test-key",
		LLMVirtualKey:     "vk-test",
		GatewayBaseURL:    "https://gateway.test",
		LangwatchEndpoint: "https://app.test",
	}

	// The localUNSAFE runner no-ops the chowns: the test process is unprivileged, so
	// real chowns would EPERM. The config.json content under test is unaffected.
	err := NewAgent(0).Provision(ProvisionInput{
		Home:           home,
		WorkspaceRoot:  workspace,
		Creds:          creds,
		UID:            0,
		AgentsTemplate: agentsTemplateFixture,
		Runner:         localunsafe.Runner{},
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(home, ".config", "opencode", "config.json"))
	if err != nil {
		t.Fatalf("read config.json: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("unmarshal config.json: %v", err)
	}

	if _, present := cfg["mcp"]; present {
		t.Errorf("config.json contains an %q key; Langy is CLI + skills only, no MCP server (got %v)", "mcp", cfg["mcp"])
	}
	if cfg["model"] == nil {
		t.Errorf("config.json lost the model key: model=%v", cfg["model"])
	}
	// No "plugin" key: the external OTel plugin was removed from the worker config
	// because evaluating its ~2 MB bundle at first-message bootstrap cost 15-25s and
	// killed turns. Worker telemetry is host-mediated now, and the worker runs no
	// plugins at all since the build agent's own prompt made the identity plugin
	// obsolete.
	if _, present := cfg["plugin"]; present {
		t.Errorf("config.json must not carry a %q key — the OTel plugin was removed from the worker (got %v)", "plugin", cfg["plugin"])
	}

	// A headless worker cannot answer opencode's interactive permission prompts, so
	// every permission MUST be auto-allowed or the first "ask" (bash/edit/
	// external_directory) wedges the turn until the liveness sweep gives up. The OS
	// sandbox + turn timeout are the boundary, not a TUI prompt.
	if cfg["permission"] != "allow" {
		t.Errorf("config.json must set permission=allow for a headless worker, got %v", cfg["permission"])
	}

	// Not a plaintext leak either: with no mcp block, the API key must not appear
	// anywhere in the config file. The CLI reads it from the process env instead.
	if strings.Contains(string(raw), creds.LangwatchAPIKey) {
		t.Errorf("config.json contains the LangWatch API key; it belongs in the worker process env, not the opencode config")
	}

	// An OpenAI model must request the reasoning summary: without it the
	// Responses API returns none of the reasoning it bills for, opencode emits
	// no reasoning parts, and the panel's thinking glimpse stays dark through
	// every LLM call.
	if !strings.Contains(string(raw), `"reasoningSummary": "auto"`) {
		t.Errorf("config.json must request the OpenAI reasoning summary; got\n%s", raw)
	}

	// A non-codex OpenAI model keeps the default store (server-side state); the
	// stateless store:false override is codex-only, so it must NOT appear here.
	if strings.Contains(string(raw), `"store"`) {
		t.Errorf("config.json set store on a non-codex model; store:false is codex-only\n%s", raw)
	}

	// An openai/ model runs the NATIVE openai provider (Responses dialect);
	// the generic chat-completions lane must not be declared alongside it.
	if strings.Contains(string(raw), gatewayProviderID+"/") {
		t.Errorf("native openai model must not route through the generic lane\n%s", raw)
	}

	target, err := os.Readlink(skillsDir(home))
	if err != nil {
		t.Fatalf("skills symlink missing — with MCP gone, skills + CLI are the entire capability surface: %v", err)
	}
	if want := filepath.Join(workspace, "skills"); target != want {
		t.Errorf("skills link target = %q, want %q", target, want)
	}
}

// The build agent — opencode's default, the one every posted turn runs — must
// carry Langy's own prompt and the role-scoped tool denies. Setting a prompt on
// the agent is what makes opencode DROP its stock coding-agent prompt instead
// of appending to it, and a per-agent "deny" removes the tool from the
// advertised schema (per-agent rules merge after the root "allow" and the last
// match wins), so this block is the whole minimal-harness mechanism.
//
// @scenario "The system prompt is Langy's own, not a coding agent's"
// @scenario "The worker does not expose tools the panel cannot show"
// @scenario "The harness's own built-in skill is denied by name"
func TestProvision_ConfiguresLangyBuildAgent(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "skills"), 0o755); err != nil {
		t.Fatalf("mkdir shared skills: %v", err)
	}

	err := NewAgent(0).Provision(ProvisionInput{
		Home:          home,
		WorkspaceRoot: workspace,
		Creds: domain.Credentials{
			LangwatchAPIKey:   "sk-lw-test-key",
			LLMVirtualKey:     "vk-test",
			GatewayBaseURL:    "https://gateway.test",
			LangwatchEndpoint: "https://app.test",
		},
		UID:            0,
		AgentsTemplate: "# AGENTS\n",
		Runner:         localunsafe.Runner{},
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(home, ".config", "opencode", "config.json"))
	if err != nil {
		t.Fatalf("read config.json: %v", err)
	}
	var cfg struct {
		Agent struct {
			Build struct {
				Prompt string `json:"prompt"`
				// any, not string: a tool's rule is an action, but "skill" carries
				// a per-name map so one built-in skill can be denied by name.
				Permission map[string]any `json:"permission"`
			} `json:"build"`
		} `json:"agent"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("unmarshal config.json: %v", err)
	}

	prompt := cfg.Agent.Build.Prompt
	if prompt == "" {
		t.Fatalf("config.json carries no agent.build.prompt — opencode would fall back to its stock coding-agent prompt")
	}
	if !strings.Contains(prompt, "Langy") || !strings.Contains(prompt, "AGENTS.md") {
		t.Errorf("agent.build.prompt must carry the Langy persona and point at the AGENTS.md contract; got\n%s", prompt)
	}

	// Subagent spawning is denied because the panel has no surface for it. The
	// harness's own question prompt is denied because Langy asks with its own
	// question tool, which the panel renders as a choices card.
	for _, tool := range []string{"task", "question"} {
		if got := cfg.Agent.Build.Permission[tool]; got != "deny" {
			t.Errorf("agent.build.permission[%q] = %v, want %q — the panel cannot show this tool's work", tool, got, "deny")
		}
	}
	// bash, edit, todowrite and webfetch stay OFF the deny list: the CLI, the
	// GitHub skill's repo work, dataset file preparation and the plan panel run
	// on them (an edit deny would also remove write and apply_patch), and
	// webfetch is how Langy reads anything that is not in LangWatch's own docs.
	// Egress is governed by the per-worker proxy, not by removing the tool.
	for _, tool := range []string{"bash", "edit", "todowrite", "webfetch"} {
		if got, present := cfg.Agent.Build.Permission[tool]; present && got == "deny" {
			t.Errorf("agent.build.permission[%q] = deny — this tool is part of Langy's role", tool)
		}
	}
	// "skill" is denied per NAME, never wholesale. opencode reads a bare "deny"
	// here as pattern "*", which switches the skill tool off and takes every
	// skill we ship out of the prompt with it.
	skillRule, ok := cfg.Agent.Build.Permission["skill"].(map[string]any)
	if !ok {
		t.Fatalf("agent.build.permission[\"skill\"] = %v, want a per-name map — a bare action would disable every shipped skill",
			cfg.Agent.Build.Permission["skill"])
	}
	// opencode's one built-in skill. The env switches in buildWorkerEnv turn off
	// the directory scans; this one is embedded in the binary and only a
	// permission rule reaches it. Denying it by name drops it from
	// <available_skills>, which is assembled from the skills the ruleset allows.
	if got := skillRule["customize-opencode"]; got != "deny" {
		t.Errorf("agent.build.permission[\"skill\"][\"customize-opencode\"] = %v, want %q — its description is prompt weight for a task outside Langy's scope",
			got, "deny")
	}
	if _, present := skillRule["*"]; present {
		t.Errorf("agent.build.permission[\"skill\"] carries a %q pattern: %v — that gates every shipped skill, not the built-in", "*", skillRule)
	}
	if len(skillRule) != 1 {
		t.Errorf("agent.build.permission[\"skill\"] has %d patterns, want exactly 1 (customize-opencode); got %v", len(skillRule), skillRule)
	}
	// Those three are the whole rule set. Without this, a later deny added for
	// a tool the role needs passes every check above, since a name absent from
	// the loop is never looked at.
	if len(cfg.Agent.Build.Permission) != 3 {
		t.Errorf("agent.build.permission has %d entries, want exactly 3 (task, question, skill); got %v",
			len(cfg.Agent.Build.Permission), cfg.Agent.Build.Permission)
	}
}

// A worker home re-provisioned in place may still carry the retired identity
// plugin from an earlier run. opencode auto-loads every plugin/*.js under the
// config dir, so Provision must remove the leftover, not merely stop writing
// its own.
func TestProvision_RemovesRetiredPluginDir(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "skills"), 0o755); err != nil {
		t.Fatalf("mkdir shared skills: %v", err)
	}
	pluginPath := filepath.Join(home, ".config", "opencode", "plugin", "langy-identity.js")
	if err := os.MkdirAll(filepath.Dir(pluginPath), 0o755); err != nil {
		t.Fatalf("mkdir plugin dir: %v", err)
	}
	if err := os.WriteFile(pluginPath, []byte("stale"), 0o644); err != nil {
		t.Fatalf("seed leftover plugin: %v", err)
	}

	err := NewAgent(0).Provision(ProvisionInput{
		Home:          home,
		WorkspaceRoot: workspace,
		Creds: domain.Credentials{
			LangwatchAPIKey:   "sk-lw-test-key",
			LLMVirtualKey:     "vk-test",
			GatewayBaseURL:    "https://gateway.test",
			LangwatchEndpoint: "https://app.test",
		},
		UID:            0,
		AgentsTemplate: "# AGENTS\n",
		Runner:         localunsafe.Runner{},
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	if _, err := os.Stat(filepath.Join(home, ".config", "opencode", "plugin")); !os.IsNotExist(err) {
		t.Errorf("plugin dir survived Provision — a leftover plugin/*.js would still be auto-loaded (stat err: %v)", err)
	}
}

// A codex model must run stateless: store:false in the generated config. The
// codex backend keeps no server-side response state, so opencode's AI SDK has
// to round-trip the encrypted reasoning content across a tool loop's steps,
// which it only does when it knows the store is off. Without this the config
// would carry a bare openai model and every multi-step codex turn would die.
func TestProvision_CodexModelRunsStateless(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "skills"), 0o755); err != nil {
		t.Fatalf("mkdir shared skills: %v", err)
	}

	err := NewAgent(0).Provision(ProvisionInput{
		Home:          home,
		WorkspaceRoot: workspace,
		Creds: domain.Credentials{
			Model:             "openai_codex/gpt-5.6-terra",
			LangwatchAPIKey:   "sk-lw-test-key",
			LLMVirtualKey:     "vk-test",
			GatewayBaseURL:    "https://gateway.test",
			LangwatchEndpoint: "https://app.test",
		},
		UID:            0,
		AgentsTemplate: "# AGENTS\n",
		Runner:         localunsafe.Runner{},
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	raw, err := os.ReadFile(filepath.Join(home, ".config", "opencode", "config.json"))
	if err != nil {
		t.Fatalf("read config.json: %v", err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("unmarshal config.json: %v", err)
	}

	// The codex prefix is rewritten to opencode's native openai provider on the
	// bare model id; the gateway restores the prefix on the wire.
	if cfg["model"] != "openai/gpt-5.6-terra" {
		t.Errorf("codex model must map to the native openai provider, got %v", cfg["model"])
	}
	opts := codexModelOptions(t, cfg, "gpt-5.6-terra")
	if opts["store"] != false {
		t.Errorf("codex config must set store:false for the stateless backend; options=%v", opts)
	}
	// The reasoning summary still applies to codex turns.
	if opts["reasoningSummary"] != "auto" {
		t.Errorf("codex config must keep reasoningSummary:auto; options=%v", opts)
	}
}

// The generic chat-completions lane: every model whose provider is not the
// native openai/codex Responses path gets a config-declared OpenAI-compatible
// provider pointed at the worker's LLM base URL env, with the FULL
// provider-prefixed id preserved verbatim as the model — dots, colons, and
// extra slashes included. One shape for every provider; nothing here may
// branch per provider name.
func TestProvision_GenericProviderLane(t *testing.T) {
	for _, model := range []string{
		"anthropic/claude-sonnet-4-6",
		"gemini/gemini-2.5-pro",
		"azure/my-gpt4-deployment",
		"bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
		"vertex_ai/gemini/gemini-2.5-pro",
	} {
		t.Run(model, func(t *testing.T) {
			home := t.TempDir()
			workspace := t.TempDir()
			if err := os.MkdirAll(filepath.Join(workspace, "skills"), 0o755); err != nil {
				t.Fatalf("mkdir shared skills: %v", err)
			}

			err := NewAgent(0).Provision(ProvisionInput{
				Home:          home,
				WorkspaceRoot: workspace,
				Creds: domain.Credentials{
					Model:             model,
					LangwatchAPIKey:   "sk-lw-test-key",
					LLMVirtualKey:     "vk-test",
					GatewayBaseURL:    "https://gateway.test",
					LangwatchEndpoint: "https://app.test",
				},
				UID:            0,
				AgentsTemplate: "# AGENTS\n",
				Runner:         localunsafe.Runner{},
			})
			if err != nil {
				t.Fatalf("Provision: %v", err)
			}

			raw, err := os.ReadFile(filepath.Join(home, ".config", "opencode", "config.json"))
			if err != nil {
				t.Fatalf("read config.json: %v", err)
			}
			var cfg map[string]any
			if err := json.Unmarshal(raw, &cfg); err != nil {
				t.Fatalf("unmarshal config.json: %v", err)
			}

			// opencode splits the model reference at the FIRST slash, so this
			// targets the gateway provider with the full prefixed id intact.
			if want := gatewayProviderID + "/" + model; cfg["model"] != want {
				t.Errorf("config model = %v, want %q", cfg["model"], want)
			}

			lane := genericProviderBlock(t, cfg)
			// Bundled into the opencode binary — instantiating it costs zero
			// package installs on the turn's critical path.
			if lane["npm"] != "@ai-sdk/openai-compatible" {
				t.Errorf("generic lane npm = %v, want @ai-sdk/openai-compatible", lane["npm"])
			}
			options, ok := lane["options"].(map[string]any)
			if !ok {
				t.Fatalf("generic lane missing options: %v", lane)
			}
			// The env placeholders keep the config free of URLs and keys: the
			// SAME worker env feeds both the native and the generic lane, so
			// mediated and unmediated wiring both keep working unchanged.
			if options["baseURL"] != "{env:OPENAI_BASE_URL}" {
				t.Errorf("generic lane baseURL = %v, want the env placeholder", options["baseURL"])
			}
			if options["apiKey"] != "{env:OPENAI_API_KEY}" {
				t.Errorf("generic lane apiKey = %v, want the env placeholder", options["apiKey"])
			}
			if strings.Contains(string(raw), "vk-test") {
				t.Errorf("config.json contains the virtual key; credentials ride the env, never the file")
			}
			models, ok := lane["models"].(map[string]any)
			if !ok {
				t.Fatalf("generic lane missing models: %v", lane)
			}
			if _, present := models[model]; !present {
				t.Errorf("generic lane models must key the full id %q verbatim, got %v", model, models)
			}
			// No fabricated limits: absent limit metadata disables opencode's
			// auto-compaction rather than inventing a context window the model
			// may not have.
			if strings.Contains(string(raw), `"limit"`) {
				t.Errorf("generic lane must not fabricate model limits; got\n%s", raw)
			}
			// The Responses-dialect options are native-lane concerns; the
			// generic lane's request must stay free of provider-specific knobs.
			if strings.Contains(string(raw), "reasoningSummary") {
				t.Errorf("generic lane must not carry the openai reasoningSummary option; got\n%s", raw)
			}
		})
	}
}

// genericProviderBlock digs provider.<gatewayProviderID> out of the parsed
// config, failing the test if the path is not shaped as expected.
func genericProviderBlock(t *testing.T, cfg map[string]any) map[string]any {
	t.Helper()
	provider, ok := cfg["provider"].(map[string]any)
	if !ok {
		t.Fatalf("config missing provider block: %v", cfg["provider"])
	}
	lane, ok := provider[gatewayProviderID].(map[string]any)
	if !ok {
		t.Fatalf("config missing provider.%s: %v", gatewayProviderID, provider)
	}
	return lane
}

// codexModelOptions digs the provider.openai.models.<id>.options map out of the
// parsed config, failing the test if the path is not shaped as expected.
func codexModelOptions(t *testing.T, cfg map[string]any, modelID string) map[string]any {
	t.Helper()
	provider, ok := cfg["provider"].(map[string]any)
	if !ok {
		t.Fatalf("config missing provider block: %v", cfg["provider"])
	}
	openai, ok := provider["openai"].(map[string]any)
	if !ok {
		t.Fatalf("config missing provider.openai: %v", provider)
	}
	models, ok := openai["models"].(map[string]any)
	if !ok {
		t.Fatalf("config missing provider.openai.models: %v", openai)
	}
	model, ok := models[modelID].(map[string]any)
	if !ok {
		t.Fatalf("config missing model %q: %v", modelID, models)
	}
	opts, ok := model["options"].(map[string]any)
	if !ok {
		t.Fatalf("config missing options for %q: %v", modelID, model)
	}
	return opts
}

// EnableOpenTelemetry turns on opencode's NATIVE OTel export in the generated
// config (experimental.openTelemetry) — the ~0s-bootstrap replacement for the
// removed plugin — and leaves it entirely absent otherwise, so a relay-less
// worker never boots an exporter with nowhere to export to.
func TestProvision_ExperimentalOpenTelemetryGate(t *testing.T) {
	for _, enabled := range []bool{true, false} {
		home := t.TempDir()
		workspace := t.TempDir()
		if err := os.MkdirAll(filepath.Join(workspace, "skills"), 0o755); err != nil {
			t.Fatalf("mkdir shared skills: %v", err)
		}
		err := NewAgent(0).Provision(ProvisionInput{
			Home:          home,
			WorkspaceRoot: workspace,
			Creds: domain.Credentials{
				LangwatchAPIKey:   "k",
				LLMVirtualKey:     "vk",
				GatewayBaseURL:    "https://gw.test",
				LangwatchEndpoint: "https://app.test",
			},
			AgentsTemplate:      "# AGENTS\n",
			Runner:              localunsafe.Runner{},
			EnableOpenTelemetry: enabled,
		})
		if err != nil {
			t.Fatalf("Provision(enabled=%v): %v", enabled, err)
		}
		raw, err := os.ReadFile(filepath.Join(home, ".config", "opencode", "config.json"))
		if err != nil {
			t.Fatalf("read config.json: %v", err)
		}
		var cfg struct {
			Experimental *struct {
				OpenTelemetry bool `json:"openTelemetry"`
			} `json:"experimental"`
		}
		if err := json.Unmarshal(raw, &cfg); err != nil {
			t.Fatalf("unmarshal config.json: %v", err)
		}
		if enabled && (cfg.Experimental == nil || !cfg.Experimental.OpenTelemetry) {
			t.Errorf("EnableOpenTelemetry=true must set experimental.openTelemetry=true; got %s", raw)
		}
		if !enabled && cfg.Experimental != nil {
			t.Errorf("EnableOpenTelemetry=false must omit the experimental block; got %s", raw)
		}
	}
}

func TestSkillsSymlink_PointsAtSharedTemplateDir(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".config", "opencode"), 0o755); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	link := skillsDir(home)
	if err := os.Symlink("/workspace/skills", link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	target, err := os.Readlink(link)
	if err != nil {
		t.Fatalf("readlink: %v", err)
	}
	if target != "/workspace/skills" {
		t.Errorf("skills link target = %q, want /workspace/skills", target)
	}
}

// The CLI's `ui call` names the conversation it drives with this variable;
// parity with the pi harness, which sets the same key.
//
// @scenario "The worker env carries the conversation id for the UI channel"
func TestBuildWorkerEnv_CarriesConversationID(t *testing.T) {
	env := buildWorkerEnv(
		"/workspace/sessions/conv-ui",
		"conv-ui",
		domain.Credentials{LangwatchAPIKey: "lw-key"},
		"pw",
		0,
		Mediation{},
		nil,
	)

	found := false
	for _, kv := range env {
		if kv == "LANGY_CONVERSATION_ID=conv-ui" {
			found = true
		}
	}
	if !found {
		t.Errorf("LANGY_CONVERSATION_ID=conv-ui missing from worker env")
	}
}
