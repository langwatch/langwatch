package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/workerenv"
)

// configFileName is the wrapper's config file, read from $HOME at boot.
// Schema: services/langyworker/PROTOCOL.md ("Config").
const configFileName = ".langy-worker.json"

// The env var NAMES the wrapper config references for the LLM base URL and
// key. Secrets stay in env; the config file carries only these names.
const (
	llmBaseURLEnv = "OPENAI_BASE_URL"
	llmAPIKeyEnv  = "OPENAI_API_KEY"
)

// mediatedLLMPlaceholderKey is what a mediated worker sends as its LLM key.
// NOT a credential: the manager's LLM relay replaces the credential headers on
// the forward, regardless of the value sent.
const mediatedLLMPlaceholderKey = "langy-mediated"

// defaultModel is what a turn that names no model runs on.
const defaultModel = "openai/gpt-5-mini"

// langyAgentPrompt is the agent's own system prompt, the whole persona slot.
// The operating contract stays in AGENTS.md, which the wrapper appends as an
// instructions file regardless of this prompt: keep the two non-overlapping,
// persona here, rules there.
const langyAgentPrompt = "You are Langy, the AI assistant built into LangWatch, operating the user's " +
	"LangWatch project from inside the product. You work by running the `langwatch` " +
	"CLI in your shell and reading its JSON output. The AGENTS.md instructions " +
	"document is your operating contract and applies to every reply. When a request " +
	"maps to a real action, you act first and answer from the result. " +
	// Without this the stock coding-agent persona leaks back in through the
	// model's priors: asked to refactor a file, Langy answers "I can't find
	// src/agent.py in this workspace, paste the contents and I'll fix it" -
	// claiming to have searched a checkout it never had. Working on the user's
	// source IS the job when they ask for it; the GitHub skill clones the
	// repository first (see AGENTS.md). What is wrong is narrating a workspace
	// that was never obtained, so this fixes the premise, not the capability.
	"Your shell does not start with a copy of the user's code in it. When their " +
	"source is the ask, the repository is cloned first and the work happens there, " +
	"so never report a file as missing, never describe reading or editing one you " +
	"have not obtained, and never ask the user to paste their code."

// ProvisionInput is everything Provision needs to lay down a worker's home.
// Runner selects the isolation substrate.
type ProvisionInput struct {
	Home          string
	WorkspaceRoot string // holds the materialized skills/ tree the config points at
	// SessionDir is the conversation's PERSISTENT pi session storage, outside
	// the worker home. The home is wiped on every worker death (reap,
	// eviction, crash), and the session JSONL living there died with it — so
	// every respawn started a fresh session, re-read the whole conversation
	// as a folded transcript, and rewrote the provider's prompt-cache prefix
	// from scratch. Living outside the home, the session survives the worker,
	// the wrapper resumes it on respawn, and the rebuilt context matches the
	// provider's cached prefix byte for byte.
	SessionDir     string
	Creds          domain.Credentials
	UID            uint32
	AgentsTemplate string
	Runner         app.Runner
}

// SpawnInput is everything Spawn needs to start the langy-worker subprocess.
type SpawnInput struct {
	BinaryPath     string
	ConversationID string
	Home           string
	UID            uint32
	Creds          domain.Credentials
	EgressPort     int
	Runner         app.Runner
	// LLMBaseURL is the manager's loopback LLM relay URL for this worker
	// (virtual key + traceparent injected on the forward). Empty ⇒ unmediated
	// fallback: the gateway URL and virtual key go into the worker env directly.
	LLMBaseURL string
	// Capabilities fold their own env into the worker process.
	Capabilities []app.Capability
}

// workerModelConfig is the config file's model entry. Unknown keys pass
// through the wrapper verbatim, so compat findings live here, not in the
// wrapper.
type workerModelConfig struct {
	ID         string         `json:"id"`
	API        string         `json:"api"`
	BaseURLEnv string         `json:"baseUrlEnv"`
	APIKeyEnv  string         `json:"apiKeyEnv"`
	Reasoning  bool           `json:"reasoning,omitempty"`
	Compat     map[string]any `json:"compat,omitempty"`
}

type workerConfig struct {
	Model          workerModelConfig `json:"model"`
	ThinkingLevel  string            `json:"thinkingLevel,omitempty"`
	PersonaPrompt  string            `json:"personaPrompt"`
	AgentsFilePath string            `json:"agentsFilePath"`
	SkillsDir      string            `json:"skillsDir,omitempty"`
	SessionDir     string            `json:"sessionDir"`
}

// modelLane maps a provider-prefixed model id onto the pi API lane and compat
// flags the W1 spike verified against the real gateway:
//
//   - anthropic/* runs the gateway's native /v1/messages route
//     (api "anthropic-messages"): real thinking signatures, cache_control
//     accepted, no compat flags.
//   - openai/* and openai_codex/* run the Responses lane, which works by
//     default (reasoning summaries stream, store:false). Codex pins
//     compat.supportsStore=false so the SDK round-trips encrypted reasoning
//     across tool steps against the stateless codex backend.
//   - everything else runs the generic chat-completions lane with
//     compat.supportsDeveloperRole=false: the gateway's non-OpenAI providers
//     reject the `developer` role pi would otherwise use for reasoning models.
//
// The model id rides verbatim (provider prefix included): the gateway's own
// prefix routing is the single source of provider fan-out, and the LLM relay
// forwards the body untouched (its codex model rewrite sets the same full id).
func modelLane(model string) workerModelConfig {
	lane := workerModelConfig{
		ID:         model,
		BaseURLEnv: llmBaseURLEnv,
		APIKeyEnv:  llmAPIKeyEnv,
	}
	switch {
	case strings.HasPrefix(model, "anthropic/"):
		lane.API = "anthropic-messages"
		lane.Reasoning = true
		// Long cache retention (with PI_CACHE_RETENTION=long in the worker
		// env) makes pi stamp its cache_control breakpoints with ttl "1h"
		// instead of the 5-minute default. A langy conversation's rhythm is
		// bursts of follow-ups separated by pauses well past five minutes
		// (the idle reap alone is longer), so the 5m tier expired before the
		// next message on exactly the turns caching exists for. The 1h write
		// costs 2x input on the cached prefix once; every follow-up inside
		// the hour then reads it at a tenth of the price.
		lane.Compat = map[string]any{"supportsLongCacheRetention": true}
	case strings.HasPrefix(model, "openai_codex/"):
		lane.API = "openai-responses"
		lane.Reasoning = true
		// NO supportsLongCacheRetention here: the ChatGPT codex backend
		// answers 400 "Unsupported parameter: prompt_cache_retention" on the
		// field the flag makes pi send (the API-key Responses endpoint
		// accepts it, which is how it slipped past the spike). The gateway
		// keeps the codex body to what that backend accepts, which is what
		// covers the fields pi sends with no flag of ours behind them (its
		// own default max output tokens, for one), so this lane only avoids
		// asking for what it knows cannot be served.
		lane.Compat = map[string]any{"supportsStore": false}
	case strings.HasPrefix(model, "openai/"):
		lane.API = "openai-responses"
		lane.Reasoning = true
		lane.Compat = map[string]any{"supportsLongCacheRetention": true}
	default:
		lane.API = "openai-completions"
		lane.Compat = map[string]any{"supportsDeveloperRole": false}
	}
	return lane
}

// skillsDir is where the config points the wrapper's skill loading: the shared
// materialized tree under WorkspaceRoot (root-owned, world-readable, workers
// can read, none can mutate). The wrapper takes the path from config, so no
// per-home symlink is needed.
func skillsDir(workspaceRoot string) string {
	return filepath.Join(workspaceRoot, "skills")
}

// provisionSessionDir stages the conversation's persistent session storage:
// the directory (and any session files a previous worker left in it) is owned
// by THIS worker's UID and 0700, the same boundary as the home. The chown
// covers the existing files too — a respawned worker runs under a fresh UID,
// and a session file still owned by the dead worker's UID would be unreadable,
// silently breaking the resume it exists for.
func provisionSessionDir(in ProvisionInput) error {
	// The stash parent (`<sessionsRoot>/.pi-sessions`) is shared by every
	// conversation and owned by the manager; a sandboxed worker only passes
	// THROUGH it to its own chowned leaf. Mode 0711 grants exactly that
	// traversal — without the execute bit a per-conversation UID gets EACCES
	// opening its own session store and the wrapper dies before its ready
	// handshake — while the absent read bit keeps sibling conversation ids
	// unlistable. Chmod unconditionally: a stash an earlier build created
	// 0700 (MkdirAll on the leaf used to mint the parent with the leaf's own
	// mode) must be repaired, and deployed volumes still hold that mode.
	stashParent := filepath.Dir(in.SessionDir)
	if err := os.MkdirAll(stashParent, 0o711); err != nil {
		return fmt.Errorf("mkdir session stash: %w", err)
	}
	if err := os.Chmod(stashParent, 0o711); err != nil {
		return fmt.Errorf("chmod session stash: %w", err)
	}
	if err := os.MkdirAll(in.SessionDir, 0o700); err != nil {
		return fmt.Errorf("mkdir sessions: %w", err)
	}
	if err := in.Runner.Chown(in.SessionDir, in.UID); err != nil {
		return fmt.Errorf("chown sessions: %w", err)
	}
	entries, err := os.ReadDir(in.SessionDir)
	if err != nil {
		return fmt.Errorf("list sessions: %w", err)
	}
	for _, entry := range entries {
		path := filepath.Join(in.SessionDir, entry.Name())
		if err := in.Runner.Chown(path, in.UID); err != nil {
			return fmt.Errorf("chown session file: %w", err)
		}
	}
	return nil
}

// Provision creates a per-worker home with the wrapper's config file, the
// substituted AGENTS.md, and the pi session dir. Isolation ordering: every
// directory is chown'd (via the runner) to the
// per-conversation UID and chmod'd 0700/0600 BEFORE per-worker material lands,
// so a sibling worker (a different UID) can never open(2) this worker's files.
// The config file itself carries no secret (env var NAMES only) but is owned
// by the worker UID like everything else in the home.
func (a *Agent) Provision(in ProvisionInput) error {
	// Lock down the worker's home BEFORE writing anything into it.
	if err := in.Runner.Chown(in.Home, in.UID); err != nil {
		return fmt.Errorf("chown home: %w", err)
	}
	if err := os.Chmod(in.Home, 0o700); err != nil {
		return fmt.Errorf("chmod home: %w", err)
	}

	// Per-worker tmp dir: scratch gets the same UID-enforced boundary as the
	// config.
	tmpDir := filepath.Join(in.Home, "tmp")
	if err := os.MkdirAll(tmpDir, 0o700); err != nil {
		return fmt.Errorf("mkdir tmp: %w", err)
	}
	if err := in.Runner.Chown(tmpDir, in.UID); err != nil {
		return fmt.Errorf("chown tmp: %w", err)
	}

	// pi session storage: persistent, outside the home (see ProvisionInput).
	// The session JSONL holds the conversation's content, so it gets the same
	// UID + 0700 boundary as everything in the home.
	if err := provisionSessionDir(in); err != nil {
		return err
	}

	// The operating contract, written through byte for byte from the embedded
	// template (read once at pool boot). Nothing is substituted into it: the
	// prompt reaches the user through the reply, so an address only the worker
	// can use must never enter it.
	if in.AgentsTemplate == "" {
		return fmt.Errorf("AGENTS.md template unavailable")
	}
	agentsPath := filepath.Join(in.Home, "AGENTS.md")
	if err := os.WriteFile(agentsPath, []byte(in.AgentsTemplate), 0o600); err != nil {
		return fmt.Errorf("write AGENTS.md: %w", err)
	}
	if err := in.Runner.Chown(agentsPath, in.UID); err != nil {
		return fmt.Errorf("chown AGENTS.md: %w", err)
	}

	model := in.Creds.Model
	if model == "" {
		model = defaultModel
	}
	cfg := workerConfig{
		Model: modelLane(model),
		// The spike's verified setting: reasoning summaries stream on the
		// Responses lane and Anthropic thinking maps through the gateway at
		// this level; trivial prompts legitimately produce no summary.
		ThinkingLevel:  "medium",
		PersonaPrompt:  langyAgentPrompt,
		AgentsFilePath: agentsPath,
		SkillsDir:      skillsDir(in.WorkspaceRoot),
		SessionDir:     in.SessionDir,
	}
	configBytes, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal worker config: %w", err)
	}
	configPath := filepath.Join(in.Home, configFileName)
	if err := os.WriteFile(configPath, configBytes, 0o600); err != nil {
		return fmt.Errorf("write worker config: %w", err)
	}
	if err := in.Runner.Chown(configPath, in.UID); err != nil {
		return fmt.Errorf("chown worker config: %w", err)
	}
	return nil
}

// Spawn starts the langy-worker subprocess and wires the stdio protocol:
// os.Pipe pairs whose *os.File ends go straight onto cmd.Stdin/cmd.Stdout, so
// exec starts NO copier goroutines and Wait can never race the reader; the
// child ends are closed after Start so the reader sees EOF the moment the
// process dies. cmd.Stderr stays nil (os/exec wires /dev/null itself, an
// io.Discard pipe there would block Wait on grandchildren, and worker stderr
// is a PII surface the manager does not read).
//
// The adapter NEVER calls cmd.Wait(): the pool's exit watcher owns it.
//
// ctx is the POOL-LIFETIME context: the worker outlives the turn that spawned
// it, and a pool shutdown still propagates to the subprocess.
func (a *Agent) Spawn(ctx context.Context, in SpawnInput) (*exec.Cmd, error) {
	stdinR, stdinW, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdoutR, stdoutW, err := os.Pipe()
	if err != nil {
		_ = stdinR.Close()
		_ = stdinW.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	cmd := in.Runner.CommandContext(ctx, in.BinaryPath)
	cmd.Env = buildWorkerEnv(in)
	cmd.Dir = in.Home
	cmd.Stdin = stdinR
	cmd.Stdout = stdoutW
	cmd.Stderr = nil
	cmd.SysProcAttr = in.Runner.SysProcAttr(in.UID)

	if err := cmd.Start(); err != nil {
		_ = stdinR.Close()
		_ = stdinW.Close()
		_ = stdoutR.Close()
		_ = stdoutW.Close()
		return nil, fmt.Errorf("start langy-worker: %w", err)
	}
	// Parent closes the CHILD ends: the child holds its own copies, and the
	// parent keeping stdoutW open would mask the child's exit from the reader.
	_ = stdinR.Close()
	_ = stdoutW.Close()

	rd := newReader(stdoutR)
	a.pipesMu.Lock()
	a.stdin = stdinW
	a.reader = rd
	a.pipesMu.Unlock()
	go rd.run(ctx)

	return cmd, nil
}

// Close releases the parent's write end of the wrapper's stdin. cmd.Wait does
// not close a directly assigned *os.File, so without this the pipe stays open
// for the manager's whole life once a worker dies. Idempotent: the pool calls
// it from both the exit and the kill path. The read end is closed by the
// reader goroutine when the wrapper's stdout reaches EOF.
func (a *Agent) Close() {
	a.pipesMu.Lock()
	stdin := a.stdin
	a.stdin = nil
	a.pipesMu.Unlock()
	if stdin != nil {
		_ = stdin.Close()
	}
}

// buildWorkerEnv assembles the environment for a langy-worker subprocess. Pure
// and side-effect free apart from reading the manager's own env, factored out
// of Spawn so it is unit-testable without spawning a real subprocess.
//
// Contract:
//   - LLM wiring: mediated ⇒ the loopback relay URL plus a non-credential
//     placeholder key; unmediated fallback ⇒ gateway URL + virtual key direct.
//   - The LANGWATCH_API_KEY/LANGWATCH_ENDPOINT pair for the langwatch CLI.
//   - NO OTLP export variables: pi exports no OTLP (the LLM relay synthesizes
//     the gen_ai spans instead).
//   - NO_PROXY/no_proxy are ALWAYS set (not only when the egress proxy runs):
//     the bun-compiled wrapper honors proxy env on its LLM fetches, and any
//     proxy variable reaching the process from anywhere else would otherwise
//     route loopback LLM traffic into the egress proxy. The W1 spike measured
//     exactly this: one contract that holds on both runtimes.
func buildWorkerEnv(in SpawnInput) []string {
	env := workerenv.BaseEnv()

	llmBaseURL, llmKey := in.Creds.GatewayBaseURL, in.Creds.LLMVirtualKey
	if in.LLMBaseURL != "" {
		llmBaseURL, llmKey = in.LLMBaseURL, mediatedLLMPlaceholderKey
	} else if strings.HasPrefix(in.Creds.Model, "anthropic/") {
		// Unmediated anthropic-messages lane: pi appends /v1/messages itself,
		// and the gateway base URL already ends in /v1. The mediated path
		// handles this join relay-side; the direct fallback strips it here.
		llmBaseURL = strings.TrimSuffix(strings.TrimRight(llmBaseURL, "/"), "/v1")
	}

	env = append(env,
		"HOME="+in.Home,
		"TMPDIR="+filepath.Join(in.Home, "tmp"),
		llmBaseURLEnv+"="+llmBaseURL,
		llmAPIKeyEnv+"="+llmKey,
		// The langwatch CLI is the worker's only LangWatch transport; the key
		// is a short-lived, revocable, per-conversation session key.
		"LANGWATCH_API_KEY="+in.Creds.LangwatchAPIKey,
		"LANGWATCH_ENDPOINT="+in.Creds.LangwatchEndpoint,
		// Long provider-cache retention: only takes effect on lanes whose
		// model carries compat.supportsLongCacheRetention (see modelLane) —
		// anthropic stamps ttl "1h" on its cache_control breakpoints, the
		// Responses lane asks for 24h prompt_cache_retention.
		"PI_CACHE_RETENTION=long",
		// The CLI's `ui call` names the conversation it is driving with this.
		// It is a claim, not a credential: the control plane verifies the id
		// belongs to the session key's owning user before doing anything.
		"LANGY_CONVERSATION_ID="+in.ConversationID,
	)
	for _, c := range in.Capabilities {
		env = append(env, c.Contribute()...)
	}
	noProxy := workerenv.NoProxyHosts(in.Creds)
	if in.EgressPort > 0 {
		proxyURL := fmt.Sprintf("http://127.0.0.1:%d", in.EgressPort)
		env = append(env,
			"HTTPS_PROXY="+proxyURL,
			"https_proxy="+proxyURL,
			"HTTP_PROXY="+proxyURL,
			"http_proxy="+proxyURL,
		)
	}
	env = append(env,
		"NO_PROXY="+noProxy,
		"no_proxy="+noProxy,
	)
	// The wrapper is a Bun-compiled binary: it trusts only its bundled CA
	// roots plus this var. Dev-only in practice.
	if ca := os.Getenv("NODE_EXTRA_CA_CERTS"); ca != "" {
		env = append(env, "NODE_EXTRA_CA_CERTS="+ca)
	}
	return env
}
