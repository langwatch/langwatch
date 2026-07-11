package workerpool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/domain"
)

func TestFilterSensitiveEnv_RemovesManagerSecrets(t *testing.T) {
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
		// PASS-THROUGH cases.
		"LANGY_MAX_WORKERS":       "keep-me", // LANGY_ prefix but not the secret one
		"HOME":                    "keep-me",
		"LANGWATCH_API_KEY_OUTER": "keep-me", // worker injects its own after; _OUTER is neither _KEY nor _SECRET
	} {
		t.Setenv(k, v)
	}

	env := filterSensitiveEnv()

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
	}
	for _, prefix := range mustBeAbsent {
		for _, kv := range env {
			if strings.HasPrefix(kv, prefix) {
				t.Errorf("env still contains %s (full: %q)", prefix, kv)
			}
		}
	}

	mustBePresent := []string{
		"LANGY_MAX_WORKERS=keep-me",
		"LANGWATCH_API_KEY_OUTER=keep-me",
	}
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

	if len(env) == 0 {
		t.Fatalf("filterSensitiveEnv returned empty slice; PATH was %q", os.Getenv("PATH"))
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

	pwA, err := generateBearerToken()
	if err != nil {
		t.Fatalf("generateBearerToken: %v", err)
	}
	pwB, err := generateBearerToken()
	if err != nil {
		t.Fatalf("generateBearerToken: %v", err)
	}

	envA := buildWorkerEnv("conv-a", "/workspace/sessions/conv-a", creds, pwA, 19001)
	envB := buildWorkerEnv("conv-b", "/workspace/sessions/conv-b", creds, pwB, 19002)

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

// buildWorkerEnv must inject the per-worker credentials + OTel wiring and, when
// present, the GitHub token; and must NOT inject GH_TOKEN when the credential
// bundle carries no GitHub token.
func TestBuildWorkerEnv_InjectsCredentialsAndConditionalGithub(t *testing.T) {
	creds := domain.Credentials{
		LangwatchAPIKey:   "lw-key",
		LLMVirtualKey:     "vk-secret",
		GatewayBaseURL:    "https://gateway.internal/v1",
		LangwatchEndpoint: "https://app.langwatch.ai",
	}
	env := buildWorkerEnv("conv-x", "/workspace/sessions/conv-x", creds, "pw", 0)

	wants := map[string]string{
		"OPENAI_BASE_URL":        "https://gateway.internal/v1",
		"OPENAI_API_KEY":         "vk-secret",
		"LANGWATCH_API_KEY":      "lw-key",
		"LANGWATCH_ENDPOINT":     "https://app.langwatch.ai",
		"OPENCODE_OTLP_ENDPOINT": "https://app.langwatch.ai/api/otel",
		"OPENCODE_OTLP_HEADERS":  "Authorization=Bearer lw-key",
	}
	for k, v := range wants {
		if got := valueOfEnv(env, k); got != v {
			t.Errorf("env[%s] = %q, want %q", k, got, v)
		}
	}
	if valueOfEnv(env, "GH_TOKEN") != "" {
		t.Errorf("GH_TOKEN must be absent when no GitHub token is provided")
	}

	creds.GithubToken = "ghp_real"
	creds.GithubLogin = "alice"
	withGH := buildWorkerEnv("conv-x", "/workspace/sessions/conv-x", creds, "pw", 0)
	if got := valueOfEnv(withGH, "GH_TOKEN"); got != "ghp_real" {
		t.Errorf("GH_TOKEN = %q, want ghp_real", got)
	}
	if got := valueOfEnv(withGH, "GITHUB_LOGIN"); got != "alice" {
		t.Errorf("GITHUB_LOGIN = %q, want alice", got)
	}
}

// buildWorkerEnv must point the worker's HTTPS_PROXY at the per-worker egress
// adapter (ADR-043) when an egress port is set, and must NO_PROXY the loopback +
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

	env := buildWorkerEnv("conv-x", "/workspace/sessions/conv-x", creds, "pw", 19555)
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
	direct := buildWorkerEnv("conv-x", "/workspace/sessions/conv-x", creds, "pw", 0)
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

func TestOpenCodeSkillsDir_UnderOpenCodeConfig(t *testing.T) {
	// opencode only discovers global skills under $HOME/.config/opencode/skills.
	home := "/home/worker-123"
	got := openCodeSkillsDir(home)
	want := filepath.Join(home, ".config", "opencode", "skills")
	if got != want {
		t.Fatalf("openCodeSkillsDir = %q, want %q", got, want)
	}
}

// workerSysProcAttr must drop the child into the per-conversation UID by default
// (setuid Credential + empty supplementary groups) and omit that Credential only
// when isolation is disabled — in both modes it keeps Setpgid so the manager can
// signal the worker's whole process group on shutdown.
func TestWorkerSysProcAttr(t *testing.T) {
	const uid = uint32(2345)

	t.Run("when isolation is disabled", func(t *testing.T) {
		attr := workerSysProcAttr(uid, true)
		if attr.Credential != nil {
			t.Errorf("Credential = %+v, want nil (opencode runs as the manager's own user)", attr.Credential)
		}
		if !attr.Setpgid {
			t.Errorf("Setpgid = false, want true even with isolation disabled")
		}
	})

	t.Run("when isolation is enabled", func(t *testing.T) {
		attr := workerSysProcAttr(uid, false)
		if attr.Credential == nil {
			t.Fatalf("Credential = nil, want a setuid credential")
		}
		if attr.Credential.Uid != uid || attr.Credential.Gid != uid {
			t.Errorf("Credential Uid/Gid = %d/%d, want %d/%d", attr.Credential.Uid, attr.Credential.Gid, uid, uid)
		}
		if attr.Credential.Groups == nil || len(attr.Credential.Groups) != 0 {
			t.Errorf("Credential.Groups = %v, want empty non-nil slice to force setgroups([])", attr.Credential.Groups)
		}
		if !attr.Setpgid {
			t.Errorf("Setpgid = false, want true")
		}
	})
}

// maybeChown / maybeLchown must skip the syscall entirely when isolation is
// disabled: pointed at a path that does not exist, a real os.Chown returns
// ENOENT, so a nil return proves the filesystem was never touched. With
// isolation enabled the syscall runs and surfaces that ENOENT.
func TestMaybeChown_NoOpWhenIsolationDisabled(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "definitely-absent")

	if err := maybeChown(missing, 2345, true); err != nil {
		t.Errorf("maybeChown(disableIsolation=true) = %v, want nil (must not touch the filesystem)", err)
	}
	if err := maybeLchown(missing, 2345, true); err != nil {
		t.Errorf("maybeLchown(disableIsolation=true) = %v, want nil (must not touch the filesystem)", err)
	}

	if err := maybeChown(missing, 2345, false); err == nil {
		t.Errorf("maybeChown(disableIsolation=false) on a missing path = nil, want an error (syscall must run)")
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
func TestSetupWorkerHome_WritesCLIOnlyConfig(t *testing.T) {
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

	// disableIsolation=true: the test process is unprivileged, so the chowns would
	// EPERM. The config.json content under test is unaffected by it.
	if err := setupWorkerHome(home, workspace, creds, 0, "1.0.0", "# AGENTS\n${LANGWATCH_ENDPOINT}\n", true); err != nil {
		t.Fatalf("setupWorkerHome: %v", err)
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
	if cfg["model"] == nil || cfg["plugin"] == nil {
		t.Errorf("config.json lost unrelated keys: model=%v plugin=%v", cfg["model"], cfg["plugin"])
	}

	// Not a plaintext leak either: with no mcp block, the API key must not appear
	// anywhere in the config file. The CLI reads it from the process env instead.
	if strings.Contains(string(raw), creds.LangwatchAPIKey) {
		t.Errorf("config.json contains the LangWatch API key; it belongs in the worker process env, not the opencode config")
	}

	target, err := os.Readlink(openCodeSkillsDir(home))
	if err != nil {
		t.Fatalf("skills symlink missing — with MCP gone, skills + CLI are the entire capability surface: %v", err)
	}
	if want := filepath.Join(workspace, "skills"); target != want {
		t.Errorf("skills link target = %q, want %q", target, want)
	}
}

func TestSkillsSymlink_PointsAtSharedTemplateDir(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".config", "opencode"), 0o755); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	link := openCodeSkillsDir(home)
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
