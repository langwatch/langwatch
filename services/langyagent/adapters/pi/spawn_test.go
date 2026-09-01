package pi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/assets"
)

// A stand-in for the embedded AGENTS.md. It carries no placeholder, because
// the provision renders nothing into the template: whatever is in the prompt
// can reach the user in a reply.
const agentsTemplateFixture = "# AGENTS\nOperating contract.\n"

func testCreds() domain.Credentials {
	return domain.Credentials{
		ProjectID:         "proj_1",
		ActorUserID:       "user_1",
		LangwatchAPIKey:   "sk-lw-session",
		LLMVirtualKey:     "vk-real",
		GatewayBaseURL:    "http://gateway.internal:5563/v1",
		LangwatchEndpoint: "http://app.internal:5560",
		Model:             "openai/gpt-5-mini",
	}
}

func provisionHome(t *testing.T, creds domain.Credentials) (home string, cfg map[string]any) {
	t.Helper()
	home = t.TempDir()
	workspace := t.TempDir()
	agent := NewAgent(0)
	if err := agent.Provision(ProvisionInput{
		Home:           home,
		WorkspaceRoot:  workspace,
		SessionDir:     filepath.Join(t.TempDir(), "conv-1"),
		Creds:          creds,
		UID:            0,
		AgentsTemplate: agentsTemplateFixture,
		Runner:         testRunner{},
	}); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(home, configFileName))
	if err != nil {
		t.Fatalf("read %s: %v", configFileName, err)
	}
	cfg = map[string]any{}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("parse %s: %v", configFileName, err)
	}
	return home, cfg
}

func modelOf(t *testing.T, cfg map[string]any) map[string]any {
	t.Helper()
	model, ok := cfg["model"].(map[string]any)
	if !ok {
		t.Fatalf("config carries no model object: %v", cfg)
	}
	return model
}

// Provision lays out the whole worker home per PROTOCOL.md: config with env
// var NAMES (never secrets), AGENTS.md, the session dir, and the shared skills
// path.
//
// @scenario "The prompt reaches the worker exactly as it was written"
func TestProvision_WritesTheWorkerHome(t *testing.T) {
	creds := testCreds()
	home, cfg := provisionHome(t, creds)

	// The persona is the SAME text the opencode provision uses.
	if cfg["personaPrompt"] != assets.LangyAgentPrompt {
		t.Errorf("personaPrompt diverged from the shared Langy persona")
	}
	if cfg["agentsFilePath"] != filepath.Join(home, "AGENTS.md") {
		t.Errorf("agentsFilePath = %v", cfg["agentsFilePath"])
	}
	agents, err := os.ReadFile(filepath.Join(home, "AGENTS.md"))
	if err != nil {
		t.Fatalf("read AGENTS.md: %v", err)
	}
	// Byte for byte, with no substitution of any kind. The prompt reaches the
	// user through the reply, so nothing the worker alone can reach may be
	// rendered into it.
	if string(agents) != agentsTemplateFixture {
		t.Errorf("AGENTS.md = %q, want the template written through unchanged (%q)", agents, agentsTemplateFixture)
	}

	sessions, _ := cfg["sessionDir"].(string)
	info, err := os.Stat(sessions)
	if err != nil || !info.IsDir() {
		t.Fatalf("sessionDir %q must exist as a directory: %v", sessions, err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Errorf("sessionDir mode = %v, want 0700", info.Mode().Perm())
	}
	// OUTSIDE the home: the home dies with the worker, and the session must
	// survive it so a respawn resumes the conversation (and the provider's
	// cached prefix) instead of re-seeding from a folded transcript.
	if strings.HasPrefix(sessions, home) {
		t.Errorf("sessionDir %q must live outside the worker home", sessions)
	}

	skills, _ := cfg["skillsDir"].(string)
	if filepath.Base(skills) != "skills" || strings.HasPrefix(skills, home) {
		t.Errorf("skillsDir %q must point at the shared workspace skills tree", skills)
	}

	// The config references env var NAMES and never a secret value.
	rawCfg, _ := os.ReadFile(filepath.Join(home, configFileName))
	for _, secret := range []string{creds.LangwatchAPIKey, creds.LLMVirtualKey} {
		if strings.Contains(string(rawCfg), secret) {
			t.Errorf("a secret landed in the config file")
		}
	}
	model := modelOf(t, cfg)
	if model["baseUrlEnv"] != "OPENAI_BASE_URL" || model["apiKeyEnv"] != "OPENAI_API_KEY" {
		t.Errorf("model env references = %v/%v", model["baseUrlEnv"], model["apiKeyEnv"])
	}
}

// The model lane selection the W1 spike verified: anthropic models take the
// gateway's native messages route, openai + codex the Responses lane (codex
// pins supportsStore off), and everything else the chat-completions lane with
// the developer-role compat flag.
//
// @scenario "The worker asks the provider for long cache retention"
func TestProvision_ModelLanes(t *testing.T) {
	compatOf := func(model map[string]any) map[string]any {
		compat, _ := model["compat"].(map[string]any)
		return compat
	}

	t.Run("anthropic models use the anthropic-messages lane", func(t *testing.T) {
		creds := testCreds()
		creds.Model = "anthropic/claude-haiku-4-5-20251001"
		_, cfg := provisionHome(t, creds)
		model := modelOf(t, cfg)
		if model["api"] != "anthropic-messages" {
			t.Errorf("api = %v", model["api"])
		}
		if model["id"] != creds.Model {
			t.Errorf("model id must ride verbatim with its provider prefix, got %v", model["id"])
		}
		// With PI_CACHE_RETENTION=long in the worker env, this is what makes
		// pi stamp ttl "1h" on its anthropic cache_control breakpoints.
		if compatOf(model)["supportsLongCacheRetention"] != true {
			t.Errorf("anthropic lane must allow long cache retention, got %v", compatOf(model))
		}
		if model["reasoning"] != true {
			t.Errorf("anthropic lane should enable reasoning")
		}
	})

	t.Run("openai models use the responses lane", func(t *testing.T) {
		_, cfg := provisionHome(t, testCreds())
		model := modelOf(t, cfg)
		if model["api"] != "openai-responses" {
			t.Errorf("api = %v", model["api"])
		}
		if compatOf(model)["supportsLongCacheRetention"] != true {
			t.Errorf("responses lane must allow long cache retention, got %v", compatOf(model))
		}
	})

	t.Run("codex models use the responses lane with store off", func(t *testing.T) {
		creds := testCreds()
		creds.Model = "openai_codex/gpt-5-codex"
		_, cfg := provisionHome(t, creds)
		model := modelOf(t, cfg)
		if model["api"] != "openai-responses" {
			t.Errorf("api = %v", model["api"])
		}
		if compatOf(model)["supportsStore"] != false {
			t.Errorf("codex must pin supportsStore false, got %v", compatOf(model))
		}
		// The ChatGPT codex backend rejects prompt_cache_retention with 400
		// "Unsupported parameter" — the flag that makes pi send it must stay
		// off on this lane, or every codex turn dies on its first LLM call.
		if _, present := compatOf(model)["supportsLongCacheRetention"]; present {
			t.Errorf("codex lane must not ask for long cache retention, got %v", compatOf(model))
		}
		if model["id"] != "openai_codex/gpt-5-codex" {
			t.Errorf("codex id must ride verbatim, got %v", model["id"])
		}
	})

	t.Run("every other provider uses the chat-completions lane", func(t *testing.T) {
		creds := testCreds()
		creds.Model = "gemini/gemini-2.5-pro"
		_, cfg := provisionHome(t, creds)
		model := modelOf(t, cfg)
		if model["api"] != "openai-completions" {
			t.Errorf("api = %v", model["api"])
		}
		if compatOf(model)["supportsDeveloperRole"] != false {
			t.Errorf("the CC lane needs supportsDeveloperRole false, got %v", compatOf(model))
		}
	})

	t.Run("no model defaults to gpt-5-mini", func(t *testing.T) {
		creds := testCreds()
		creds.Model = ""
		_, cfg := provisionHome(t, creds)
		if modelOf(t, cfg)["id"] != defaultModel {
			t.Errorf("default model = %v", modelOf(t, cfg)["id"])
		}
	})
}

// recordingRunner is testRunner with a chown ledger, for pinning that every
// file a previous worker left in the persistent session dir gets re-owned.
type recordingRunner struct {
	testRunner
	chowned []string
}

func (r *recordingRunner) Chown(path string, _ uint32) error {
	r.chowned = append(r.chowned, path)
	return nil
}

// @scenario "A respawned worker can read the previous worker's session files"
func TestProvision_ChownsLeftoverSessionFiles(t *testing.T) {
	sessionDir := filepath.Join(t.TempDir(), "conv-1")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	leftover := filepath.Join(sessionDir, "session.jsonl")
	if err := os.WriteFile(leftover, []byte("{}\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	runner := &recordingRunner{}
	agent := NewAgent(0)
	if err := agent.Provision(ProvisionInput{
		Home:           t.TempDir(),
		WorkspaceRoot:  t.TempDir(),
		SessionDir:     sessionDir,
		Creds:          testCreds(),
		UID:            4242,
		AgentsTemplate: agentsTemplateFixture,
		Runner:         runner,
	}); err != nil {
		t.Fatalf("Provision: %v", err)
	}

	// The respawned worker runs under a fresh UID; a session file still owned
	// by the dead worker's UID would be unreadable and silently break the
	// resume the persistent dir exists for.
	found := false
	for _, path := range runner.chowned {
		if path == leftover {
			found = true
		}
	}
	if !found {
		t.Fatalf("the leftover session file was never chowned; chowned = %v", runner.chowned)
	}
}

// The stash parent (`<sessionsRoot>/.pi-sessions`) is shared by every
// conversation and owned by the manager; a sandboxed worker only passes
// through it to its own chowned leaf. Mode 0711 grants exactly that: the
// execute bit is what lets a per-conversation UID traverse (without it the
// wrapper dies on EACCES before its ready handshake, which took down every
// prod pi spawn), and the absent read bit keeps sibling conversation ids
// unlistable. The chmod must also repair a stash an earlier build created
// 0700 — deployed volumes already hold that mode.
// @scenario "A sandboxed worker can enter the shared session stash"
func TestProvision_StashParentIsTraversable(t *testing.T) {
	t.Run("given no stash exists yet", func(t *testing.T) {
		stash := filepath.Join(t.TempDir(), ".pi-sessions")
		provisionIntoStash(t, stash)
		assertMode(t, stash, 0o711)
	})

	t.Run("given a stash created 0700 by an earlier build", func(t *testing.T) {
		stash := filepath.Join(t.TempDir(), ".pi-sessions")
		if err := os.MkdirAll(stash, 0o700); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		provisionIntoStash(t, stash)
		assertMode(t, stash, 0o711)
	})

	t.Run("the conversation's own store stays private", func(t *testing.T) {
		stash := filepath.Join(t.TempDir(), ".pi-sessions")
		sessionDir := provisionIntoStash(t, stash)
		assertMode(t, sessionDir, 0o700)
	})
}

func provisionIntoStash(t *testing.T, stash string) string {
	t.Helper()
	sessionDir := filepath.Join(stash, "conv-1")
	agent := NewAgent(0)
	if err := agent.Provision(ProvisionInput{
		Home:           t.TempDir(),
		WorkspaceRoot:  t.TempDir(),
		SessionDir:     sessionDir,
		Creds:          testCreds(),
		UID:            4242,
		AgentsTemplate: agentsTemplateFixture,
		Runner:         testRunner{},
	}); err != nil {
		t.Fatalf("Provision: %v", err)
	}
	return sessionDir
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("%s mode = %o, want %o", path, got, want)
	}
}

func envMap(t *testing.T, env []string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, kv := range env {
		key, value, ok := strings.Cut(kv, "=")
		if !ok {
			t.Fatalf("malformed env entry %q", kv)
		}
		out[key] = value
	}
	return out
}

// The spawn env contract: mediated LLM wiring with a placeholder key, the
// langwatch CLI pair, NO opencode-specific or OTLP variables, and NO_PROXY
// always covering loopback (the bun-compiled wrapper honors proxy env on LLM
// fetches, the W1 spike's finding).
func TestBuildWorkerEnv_Contract(t *testing.T) {
	home := t.TempDir()
	in := SpawnInput{
		Home:       home,
		Creds:      testCreds(),
		EgressPort: 4321,
		LLMBaseURL: "http://127.0.0.1:9999/w/tok/llm",
		Capabilities: []app.Capability{
			fakeWrapperCap{mode: "happy"},
		},
	}
	env := envMap(t, buildWorkerEnv(in))

	if env["HOME"] != home || env["TMPDIR"] != filepath.Join(home, "tmp") {
		t.Errorf("HOME/TMPDIR = %q/%q", env["HOME"], env["TMPDIR"])
	}
	if env["OPENAI_BASE_URL"] != in.LLMBaseURL {
		t.Errorf("mediated OPENAI_BASE_URL = %q", env["OPENAI_BASE_URL"])
	}
	if env["OPENAI_API_KEY"] != mediatedLLMPlaceholderKey {
		t.Errorf("mediated key = %q, want the non-credential placeholder", env["OPENAI_API_KEY"])
	}
	if env["PI_CACHE_RETENTION"] != "long" {
		t.Errorf("PI_CACHE_RETENTION = %q, want long (the 1h anthropic cache tier)", env["PI_CACHE_RETENTION"])
	}
	if env["LANGWATCH_API_KEY"] != "sk-lw-session" || env["LANGWATCH_ENDPOINT"] != "http://app.internal:5560" {
		t.Errorf("langwatch CLI pair = %q/%q", env["LANGWATCH_API_KEY"], env["LANGWATCH_ENDPOINT"])
	}
	if env["HTTPS_PROXY"] != "http://127.0.0.1:4321" || env["https_proxy"] != "http://127.0.0.1:4321" {
		t.Errorf("egress proxy vars = %q/%q", env["HTTPS_PROXY"], env["https_proxy"])
	}
	for _, key := range []string{"NO_PROXY", "no_proxy"} {
		for _, host := range []string{"127.0.0.1", "localhost", "gateway.internal", "app.internal"} {
			if !strings.Contains(env[key], host) {
				t.Errorf("%s = %q, must cover %s", key, env[key], host)
			}
		}
	}
	// The capability env rides through.
	if env[fakeWrapperModeEnv] != "happy" {
		t.Errorf("capability env missing: %v", env[fakeWrapperModeEnv])
	}
	// Nothing opencode-specific and no OTLP export (pi exports none).
	for key := range env {
		if strings.HasPrefix(key, "OPENCODE_") {
			t.Errorf("opencode variable %q leaked into the pi worker env", key)
		}
		if strings.HasPrefix(key, "OTEL_") {
			t.Errorf("OTLP variable %q leaked into the pi worker env", key)
		}
	}
}

// Without an egress proxy the proxy vars are absent, but NO_PROXY still rides:
// one contract that holds wherever a proxy variable might come from.
func TestBuildWorkerEnv_NoEgressStillSetsNoProxy(t *testing.T) {
	env := envMap(t, buildWorkerEnv(SpawnInput{Home: "/h", Creds: testCreds()}))
	if _, ok := env["HTTPS_PROXY"]; ok {
		t.Errorf("no egress proxy port, but HTTPS_PROXY was set")
	}
	if !strings.Contains(env["NO_PROXY"], "127.0.0.1") || !strings.Contains(env["no_proxy"], "localhost") {
		t.Errorf("NO_PROXY must always cover loopback, got %q", env["NO_PROXY"])
	}
}

// The unmediated fallback: virtual key direct, and the anthropic lane's base
// URL loses the /v1 suffix the lane re-appends itself.
func TestBuildWorkerEnv_UnmediatedFallback(t *testing.T) {
	creds := testCreds()
	env := envMap(t, buildWorkerEnv(SpawnInput{Home: "/h", Creds: creds}))
	if env["OPENAI_BASE_URL"] != creds.GatewayBaseURL || env["OPENAI_API_KEY"] != creds.LLMVirtualKey {
		t.Errorf("unmediated wiring = %q/%q", env["OPENAI_BASE_URL"], env["OPENAI_API_KEY"])
	}

	creds.Model = "anthropic/claude-haiku-4-5-20251001"
	env = envMap(t, buildWorkerEnv(SpawnInput{Home: "/h", Creds: creds}))
	if env["OPENAI_BASE_URL"] != "http://gateway.internal:5563" {
		t.Errorf("unmediated anthropic base = %q, want the /v1 suffix stripped", env["OPENAI_BASE_URL"])
	}
}

// The CLI's `ui call` names the conversation it drives with this variable; a
// worker spawned without it could never reach the page channel.
//
// @scenario "The worker env carries the conversation id for the UI channel"
func TestBuildWorkerEnv_CarriesConversationID(t *testing.T) {
	env := envMap(t, buildWorkerEnv(SpawnInput{
		Home:           "/h",
		ConversationID: "conv-ui",
		Creds:          testCreds(),
	}))

	if env["LANGY_CONVERSATION_ID"] != "conv-ui" {
		t.Errorf("LANGY_CONVERSATION_ID = %q, want conv-ui", env["LANGY_CONVERSATION_ID"])
	}
}
