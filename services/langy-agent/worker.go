package langyagent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// Credentials is the per-conversation auth bundle the control plane sends
// in each /chat request. We never persist these — they live in the worker
// subprocess's env for the lifetime of the worker, and die with it.
type Credentials struct {
	LangwatchAPIKey    string `json:"langwatchApiKey"`
	LLMVirtualKey      string `json:"llmVirtualKey"`
	GatewayBaseURL     string `json:"gatewayBaseUrl"`
	LangwatchEndpoint  string `json:"langwatchEndpoint"`
	Model              string `json:"model,omitempty"`
	GithubToken        string `json:"githubToken,omitempty"`
	GithubLogin        string `json:"githubLogin,omitempty"`
}

// Worker is the manager's bookkeeping for one OpenCode subprocess.
type Worker struct {
	conversationID    string
	port              int
	openCodeSessionID string
	cmd               *exec.Cmd
	uid               uint32

	mu       sync.Mutex
	lastSeen time.Time
}

// touch updates the worker's idle timer. Called whenever a turn arrives.
func (w *Worker) touch() {
	w.mu.Lock()
	w.lastSeen = time.Now()
	w.mu.Unlock()
}

// idleSince reports the elapsed idle duration without taking ownership.
func (w *Worker) idleSince() time.Duration {
	w.mu.Lock()
	defer w.mu.Unlock()
	return time.Since(w.lastSeen)
}

// sensitiveEnvPattern matches env names that must never reach a worker. The
// JS manager listed these by name; the Go version mirrors the policy. Add
// new prefixes here when introducing manager-only secrets.
var sensitiveEnvPattern = regexp.MustCompile(
	`^(LANGY_INTERNAL_SECRET$|GITHUB_LANGY_|CREDENTIALS_SECRET$|NEXTAUTH_|DATABASE_URL$|AWS_SECRET_)`,
)

// filterSensitiveEnv returns the process env minus anything matching
// sensitiveEnvPattern. The worker gets its own credentials injected
// explicitly after this filter.
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

// setupWorkerHome creates a per-worker home dir with its own opencode
// config, a substituted AGENTS.md, and a symlink to the shared skills/.
// Every file is chown'd to the per-conversation UID and chmod'd 0700/0600
// BEFORE any credential material lands, so a sibling worker (running as a
// different UID) can never open(2) this worker's files even with knowledge
// of the path. Requires CAP_CHOWN + CAP_DAC_OVERRIDE.
func setupWorkerHome(workerHome string, creds Credentials, uid uint32, otelPluginVersion string) error {
	// Lock down the worker's home BEFORE writing anything sensitive.
	if err := os.Chown(workerHome, int(uid), int(uid)); err != nil {
		return fmt.Errorf("chown home: %w", err)
	}
	if err := os.Chmod(workerHome, 0o700); err != nil {
		return fmt.Errorf("chmod home: %w", err)
	}

	configDir := filepath.Join(workerHome, ".config", "opencode")
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return fmt.Errorf("mkdir config: %w", err)
	}
	// MkdirAll inherits the manager's UID (root). chown every newly created
	// intermediate so the worker UID owns the whole chain — anything left
	// owned by root with mode 0700 would EACCES the worker on traversal.
	for _, dir := range []string{
		filepath.Join(workerHome, ".config"),
		configDir,
	} {
		if err := os.Chown(dir, int(uid), int(uid)); err != nil {
			return fmt.Errorf("chown %s: %w", dir, err)
		}
		if err := os.Chmod(dir, 0o700); err != nil {
			return fmt.Errorf("chmod %s: %w", dir, err)
		}
	}

	model := creds.Model
	if model == "" {
		model = "openai/gpt-5-mini"
	}

	plugin := fmt.Sprintf("@devtheops/opencode-plugin-otel@%s", otelPluginVersion)

	config := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"model":   model,
		"plugin":  []string{plugin},
		"mcp": map[string]any{
			"langwatch": map[string]any{
				"type":    "local",
				"command": []string{"langwatch-mcp-server"},
				"enabled": true,
				"environment": map[string]string{
					"LANGWATCH_API_KEY":  creds.LangwatchAPIKey,
					"LANGWATCH_ENDPOINT": creds.LangwatchEndpoint,
				},
			},
		},
	}

	configPath := filepath.Join(configDir, "config.json")
	configBytes, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(configPath, configBytes, 0o600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	// WriteFile keeps ownership at the writing process (root). Explicit chown
	// is what makes "only the worker UID" literal — without it, the
	// manager (root) could still read the plaintext API key.
	if err := os.Chown(configPath, int(uid), int(uid)); err != nil {
		return fmt.Errorf("chown config: %w", err)
	}

	// Per-worker AGENTS.md with ${LANGWATCH_ENDPOINT} substituted. The
	// shared /workspace/AGENTS.md keeps the literal placeholder; we resolve
	// it here so each worker emits concrete URLs in its replies.
	shared, err := os.ReadFile("/workspace/AGENTS.md")
	if err != nil {
		return fmt.Errorf("read shared AGENTS.md: %w", err)
	}
	rendered := strings.ReplaceAll(string(shared), "${LANGWATCH_ENDPOINT}", creds.LangwatchEndpoint)
	agentsPath := filepath.Join(workerHome, "AGENTS.md")
	if err := os.WriteFile(agentsPath, []byte(rendered), 0o600); err != nil {
		return fmt.Errorf("write AGENTS.md: %w", err)
	}
	if err := os.Chown(agentsPath, int(uid), int(uid)); err != nil {
		return fmt.Errorf("chown AGENTS.md: %w", err)
	}

	// Symlink skills/ to the shared template directory. The shared dir is
	// root-owned and world-readable (see entrypoint.sh), so workers
	// following the link can READ but cannot mutate it.
	skillsLink := filepath.Join(workerHome, "skills")
	if err := os.Symlink("/workspace/skills", skillsLink); err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("symlink skills: %w", err)
	}
	// lchown the symlink itself; target permissions are what actually gate
	// reads but lchowning prevents another UID from tampering with the link.
	_ = os.Lchown(skillsLink, int(uid), int(uid))

	return nil
}

// spawnOpenCode starts the opencode subprocess with the per-worker env and
// drops into the per-conversation UID before exec. Combined with mode 0700
// on workerHome and mode 0600 on config.json, this makes a sibling worker's
// files unreachable to this process at the kernel level — open(2) returns
// EACCES regardless of how the path is constructed.
func spawnOpenCode(
	ctx context.Context,
	cfg Config,
	conversationID, workerHome string,
	uid uint32,
	port int,
	creds Credentials,
) (*exec.Cmd, error) {
	env := filterSensitiveEnv()
	env = append(env,
		"HOME="+workerHome,
		"OPENAI_BASE_URL="+creds.GatewayBaseURL,
		"OPENAI_API_KEY="+creds.LLMVirtualKey,
		"LANGWATCH_API_KEY="+creds.LangwatchAPIKey,
		"LANGWATCH_ENDPOINT="+creds.LangwatchEndpoint,
		// OpenCode OTel plugin: opencode auto-loads it by name; the plugin
		// reads OPENCODE_OTLP_* and exports gen_ai.usage.* spans into the
		// user's LangWatch project. The OTel endpoint appends /v1/traces
		// so we hand it the /api/otel base.
		"OPENCODE_ENABLE_TELEMETRY=1",
		"OPENCODE_OTLP_ENDPOINT="+strings.TrimRight(creds.LangwatchEndpoint, "/")+"/api/otel",
		"OPENCODE_OTLP_PROTOCOL=http/protobuf",
		"OPENCODE_OTLP_HEADERS=Authorization=Bearer "+creds.LangwatchAPIKey,
		"OPENCODE_RESOURCE_ATTRIBUTES=tag.tags=langy,service.name=langy-agent,langwatch.thread.id="+conversationID,
	)
	if creds.GithubToken != "" {
		env = append(env,
			"GH_TOKEN="+creds.GithubToken,
			"GITHUB_LOGIN="+creds.GithubLogin,
		)
	}

	cmd := exec.CommandContext(ctx, cfg.OpenCodeBinaryPath,
		"serve", "--port", fmt.Sprintf("%d", port), "--hostname", "127.0.0.1",
	)
	cmd.Env = env
	cmd.Dir = workerHome
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Credential: &syscall.Credential{
			Uid: uid,
			Gid: uid,
		},
		// Setpgid puts opencode in its own process group so a SIGTERM to the
		// manager doesn't tear down the worker before we've gracefully reaped
		// it; we send the explicit signal during shutdown.
		Setpgid: true,
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start opencode: %w", err)
	}
	return cmd, nil
}

// removeWorkerHome deletes the per-worker dir. Its config.json holds the
// plaintext LangWatch API key; ${HOME}/work holds cloned repos. Without
// this, secrets and clones accumulate on the pod volume forever — the
// github.md skill's "the idle reaper cleans it with the session" guarantee
// lives here.
func removeWorkerHome(sessionsRoot, conversationID string, log *zap.Logger) {
	if !isValidConversationID(conversationID) {
		return
	}
	workerHome := filepath.Join(sessionsRoot, conversationID)
	resolvedRoot, err := filepath.Abs(sessionsRoot)
	if err != nil {
		return
	}
	resolvedHome, err := filepath.Abs(workerHome)
	if err != nil {
		return
	}
	if !strings.HasPrefix(resolvedHome, resolvedRoot+string(filepath.Separator)) {
		return
	}
	if err := os.RemoveAll(workerHome); err != nil {
		log.Warn("remove worker home failed",
			zap.String("conversation", conversationID),
			zap.Error(err),
		)
	}
}
