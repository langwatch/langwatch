package app

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// TestMain puts an op that always refuses first on PATH and clears the
// account, so no test in this package can reach a developer's real vault.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "haven-no-op-")
	if err != nil {
		panic(err)
	}
	script := "#!/bin/sh\necho 'op is stubbed out in tests' >&2\nexit 1\n"
	if err := os.WriteFile(filepath.Join(dir, "op"), []byte(script), 0o700); err != nil { //nolint:gosec // an executable stub
		panic(err)
	}
	_ = os.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	_ = os.Unsetenv(domain.OnePasswordAccountKey)
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

// opStubScript is a fake op: it logs its argv, answers `item get` from
// item.json (or the error in fail), and stores what create/edit read on stdin.
const opStubScript = `#!/bin/sh
dir="$(dirname "$0")"
printf '%s\n' "$*" >> "$dir/argv.log"
case "$1 $2" in
"item get")
  if [ -f "$dir/fail" ]; then cat "$dir/fail" >&2; exit 1; fi
  if [ -f "$dir/item.json" ]; then cat "$dir/item.json"; exit 0; fi
  echo '[ERROR] "LangWatch Dev" isn'"'"'t an item in the "Private" vault.' >&2; exit 1 ;;
"item create"|"item edit")
  if [ -f "$dir/readonly" ]; then cat > /dev/null; exit 0; fi
  cat > "$dir/item.json"; echo '{"id":"stored"}'; exit 0 ;;
esac
exit 1
`

type opStub struct{ dir string }

// stubOnePassword puts the fake op first on PATH and forgets any cached read.
func stubOnePassword(t *testing.T) opStub {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "op"), []byte(opStubScript), 0o700); err != nil { //nolint:gosec // an executable stub
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	forgetOnePassword()
	t.Cleanup(forgetOnePassword)
	return opStub{dir: dir}
}

func (s opStub) holds(t *testing.T, fields map[string]string) {
	t.Helper()
	raw, err := domain.NewOnePasswordItem(fields)
	if err != nil {
		t.Fatal(err)
	}
	s.write(t, "item.json", string(raw))
}

func (s opStub) write(t *testing.T, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(s.dir, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func (s opStub) calls(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(s.dir, "argv.log"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(raw)), "\n")
}

func (s opStub) stored(t *testing.T) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(s.dir, "item.json"))
	if err != nil {
		t.Fatal(err)
	}
	fields, err := domain.OnePasswordFields(raw)
	if err != nil {
		t.Fatal(err)
	}
	return fields
}

func checkoutWithDotenv(t *testing.T, content string) string {
	t.Helper()
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, ".env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return repo
}

// @scenario "A key only 1Password holds counts as configured"
func TestAKeyOnlyTheItemHoldsCountsAsConfigured(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"STRIPE_SECRET_KEY": "sk_test_fromitem"})
	t.Setenv("STRIPE_SECRET_KEY", "")
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")

	resolved := resolvedDevEnv(repo)
	if resolved["STRIPE_SECRET_KEY"] != "sk_test_fromitem" {
		t.Fatal("STRIPE_SECRET_KEY was not answered from the item")
	}
	if env := domain.PaymentProviderEnv(resolved, "https://payment.test"); env != nil {
		t.Errorf("paymentsim was pointed at billing over a key the item holds: %v", env)
	}
}

// @scenario "The shell and .env still win over the item"
func TestTheShellAndDotenvWinOverTheItem(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem", "GROQ_API_KEY": "groqitem"})
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("GROQ_API_KEY", "")
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\nOPENAI_API_KEY=fromdotenv\n")

	if got := resolvedDevEnv(repo)["OPENAI_API_KEY"]; got != "fromdotenv" {
		t.Errorf("OPENAI_API_KEY resolved to %q, want the .env value", got)
	}
	env := onePasswordChildEnv(repo)
	if slices.Contains(env, "OPENAI_API_KEY=fromitem") {
		t.Error("the item's OPENAI_API_KEY was injected over the .env value")
	}
	if !slices.Contains(env, "GROQ_API_KEY=groqitem") {
		t.Errorf("the item's GROQ_API_KEY was not injected: %d entries", len(env))
	}
}

// @scenario "The item is read once with one op call"
func TestTheItemIsReadOnce(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem"})
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")

	for range 3 {
		_ = resolvedDevEnv(repo)
		_ = onePasswordChildEnv(repo)
	}
	calls := op.calls(t)
	if len(calls) != 1 {
		t.Fatalf("op was called %d times, want once: %v", len(calls), calls)
	}
	if !strings.HasPrefix(calls[0], "item get LangWatch Dev --vault Private") || !strings.HasSuffix(calls[0], "--account acme") {
		t.Errorf("op was called as %q", calls[0])
	}
}

// @scenario "A locked or missing op leaves the stack as it was"
func TestALockedOrMissingOpLeavesTheStackAsItWas(t *testing.T) {
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")

	op := stubOnePassword(t)
	op.write(t, "fail", "[ERROR] account is not signed in\n")
	if _, err := onePasswordFields("acme"); err == nil || !strings.Contains(err.Error(), "not signed in") {
		t.Errorf("a locked vault answered %v, want op's reason", err)
	}
	if env := onePasswordChildEnv(repo); env != nil {
		t.Errorf("a locked vault injected %d entries, want none", len(env))
	}

	forgetOnePassword()
	t.Setenv("PATH", t.TempDir())
	if _, err := onePasswordFields("acme"); err == nil || !strings.Contains(err.Error(), "op not found") {
		t.Errorf("a missing op answered %v, want it named", err)
	}
}

// @scenario "Every process haven starts reads the item when it starts"
func TestEveryLaneReadsTheItemWhenItStarts(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem"})
	t.Setenv("OPENAI_API_KEY", "")
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")
	sel := domain.DefaultSelection()
	sel.Langevals = true

	children := langevalsPlan(t, sel, repo)
	for _, name := range []string{APILane, "langevals", GoLane} {
		lane, ok := findChild(children, name)
		if !ok {
			t.Fatalf("no %s lane planned", name)
		}
		if lane.SecretsFrom != repo || slices.Contains(lane.Env, "OPENAI_API_KEY=fromitem") {
			t.Errorf("the %s lane does not read the item at start, or carries its value in the plan", name)
		}
		if !slices.Contains(withSecretsAtStart(lane).EnvAtStart(), "OPENAI_API_KEY=fromitem") {
			t.Errorf("the %s lane's start does not get the item's field", name)
		}
	}
	once := withItemEnv(repo, []string{"OPENAI_API_KEY=mine"})
	if slices.Index(once, "OPENAI_API_KEY=fromitem") > slices.Index(once, "OPENAI_API_KEY=mine") {
		t.Error("a one-shot run's own env does not win over the item")
	}
}

// @scenario "No 1Password value is written to disk"
func TestThePlanFileHoldsNoItemValue(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem-must-not-persist"})
	t.Setenv("OPENAI_API_KEY", "")
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")
	sel := domain.DefaultSelection()
	sel.Langevals = true

	children := langevalsPlan(t, sel, repo)
	for i := range children {
		children[i] = withSecretsAtStart(children[i])
		if children[i].EnvAtStart != nil {
			_ = children[i].EnvAtStart() // a lane started before the plan is written
		}
	}
	path := filepath.Join(t.TempDir(), "run", "test", "plan.json")
	if err := writeKeeperPlan(path, KeeperPlan{Children: children, Env: os.Environ()}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "fromitem-must-not-persist") {
		t.Fatal("the keeper plan holds a 1Password value")
	}
	if !strings.Contains(string(raw), `"SecretsFrom"`) {
		t.Error("the keeper plan does not say which lanes read the item at start")
	}
}

const pemValue = "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----"

func moveFixture() string {
	return "# local config\nBASE_HOST=http://localhost:5560\nOPENAI_API_KEY=sk-openai-value\n" +
		"DATABASE_URL=postgresql://localhost:5432/langwatch\n" +
		"GITHUB_APP_PRIVATE_KEY=\"" + pemValue + "\"\nEMPTY_API_KEY=\n"
}

// @scenario "The move is a dry run until it is applied"
func TestTheMoveIsADryRunUntilApplied(t *testing.T) {
	op := stubOnePassword(t)
	repo := checkoutWithDotenv(t, moveFixture())
	var out bytes.Buffer

	if err := (&Orchestrator{}).SecretsMove(SecretsMoveParams{WorktreeDir: repo, Account: "acme"}, &out); err != nil {
		t.Fatal(err)
	}
	printed := out.String()
	for _, key := range []string{"OPENAI_API_KEY", "GITHUB_APP_PRIVATE_KEY"} {
		if !strings.Contains(printed, key) {
			t.Errorf("the dry run did not name %s:\n%s", key, printed)
		}
	}
	for _, kept := range []string{"BASE_HOST", "DATABASE_URL", "EMPTY_API_KEY", "sk-openai-value", "MIIBVQ"} {
		if strings.Contains(printed, kept) {
			t.Errorf("the dry run printed %q:\n%s", kept, printed)
		}
	}
	if raw, _ := os.ReadFile(filepath.Join(repo, ".env")); string(raw) != moveFixture() {
		t.Error("the dry run changed .env")
	}
	if calls := op.calls(t); calls != nil {
		t.Errorf("the dry run called op: %v", calls)
	}
}

// @scenario "Applying the move fills the item, then rewrites .env"
func TestApplyingTheMoveFillsTheItemThenRewritesDotenv(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(fmt.Sprintf("item exists %v", existing), func(t *testing.T) {
			op := stubOnePassword(t)
			if existing {
				op.write(t, "item.json", `{"id":"abc","title":"LangWatch Dev","category":"SECURE_NOTE","fields":[`+
					`{"id":"notesPlain","purpose":"NOTES","label":"notesPlain","value":"mine"},`+
					`{"id":"k1","label":"KEEP_TOKEN","type":"CONCEALED","value":"kept"},`+
					`{"id":"k2","label":"OPENAI_API_KEY","type":"CONCEALED","value":"stale"}]}`)
			}
			repo := checkoutWithDotenv(t, moveFixture())
			var out bytes.Buffer

			err := (&Orchestrator{}).SecretsMove(SecretsMoveParams{WorktreeDir: repo, Account: "acme", Apply: true}, &out)
			if err != nil {
				t.Fatal(err)
			}
			for _, call := range op.calls(t) {
				if strings.Contains(call, "sk-openai-value") || strings.Contains(call, "MIIBVQ") {
					t.Fatalf("a value reached op's arguments: %q", call)
				}
			}
			if strings.Contains(out.String(), "sk-openai-value") {
				t.Error("the move printed a value")
			}
			stored := op.stored(t)
			if stored["OPENAI_API_KEY"] != "sk-openai-value" || stored["GITHUB_APP_PRIVATE_KEY"] != pemValue {
				t.Error("the item does not hold the moved values")
			}
			if existing && stored["KEEP_TOKEN"] != "kept" {
				t.Error("editing the item dropped a field it already had")
			}
			raw, _ := os.ReadFile(filepath.Join(repo, ".env"))
			want := "# local config\nBASE_HOST=http://localhost:5560\n" +
				"DATABASE_URL=postgresql://localhost:5432/langwatch\nEMPTY_API_KEY=\nLANGWATCH_OP_ACCOUNT=\"acme\"\n"
			if string(raw) != want {
				t.Errorf(".env after the move is\n%s\nwant\n%s", raw, want)
			}
		})
	}
}

// @scenario "Applying the move fills the item, then rewrites .env"
func TestAMoveTheItemDoesNotReadBackLeavesDotenvAlone(t *testing.T) {
	op := stubOnePassword(t)
	op.write(t, "readonly", "")
	repo := checkoutWithDotenv(t, moveFixture())

	err := (&Orchestrator{}).SecretsMove(SecretsMoveParams{WorktreeDir: repo, Account: "acme", Apply: true}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), ".env is untouched") {
		t.Fatalf("a write the item did not keep answered %v", err)
	}
	if strings.Contains(err.Error(), "sk-openai-value") {
		t.Error("the refusal carries a value")
	}
	if raw, _ := os.ReadFile(filepath.Join(repo, ".env")); string(raw) != moveFixture() {
		t.Error(".env was rewritten although the item did not read back")
	}
}

// @scenario "A credential back in .env is named at haven up"
func TestACredentialBackInDotenvIsNamed(t *testing.T) {
	repo := checkoutWithDotenv(t, moveFixture())
	warning := dotenvCredentialWarning(repo)
	if !strings.Contains(warning, "OPENAI_API_KEY") || !strings.Contains(warning, "haven secrets move") {
		t.Errorf("the warning is %q", warning)
	}
	if strings.Contains(warning, "sk-openai-value") || strings.Contains(warning, "BASE_HOST") {
		t.Errorf("the warning names a value or a config key: %q", warning)
	}
	if got := dotenvCredentialWarning(checkoutWithDotenv(t, "BASE_HOST=http://x\n")); got != "" {
		t.Errorf("a config-only .env warned %q", got)
	}
}

func TestSecretsExecEnvCarriesEachKeyOnce(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem"})
	t.Setenv(domain.OnePasswordAccountKey, "acme")
	t.Setenv("OPENAI_API_KEY", "")

	env := SecretsExecEnv(t.TempDir())
	seen := map[string]int{}
	for _, kv := range env {
		key, _, _ := strings.Cut(kv, "=")
		seen[key]++
	}
	if seen[domain.OnePasswordAccountKey] != 1 || seen["OPENAI_API_KEY"] != 1 { // the account passes through
		t.Errorf("keys repeat: account %d, OPENAI_API_KEY %d", seen[domain.OnePasswordAccountKey], seen["OPENAI_API_KEY"])
	}
	if !slices.Contains(env, "OPENAI_API_KEY=fromitem") || !slices.Contains(env, SecretsExecMarker+"=1") {
		t.Error("the exec env lacks the item's field or the marker")
	}
}
