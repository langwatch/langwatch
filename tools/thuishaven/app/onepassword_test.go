package app

import (
	"errors"
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
	if !strings.HasPrefix(calls[0], "item get LangWatch haven secrets --vault Private") || !strings.HasSuffix(calls[0], "--account acme") {
		t.Errorf("op was called as %q", calls[0])
	}
}

// @scenario "A locked or missing op leaves the stack as it was"
func TestALockedOrMissingOpLeavesTheStackAsItWas(t *testing.T) {
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")

	op := stubOnePassword(t)
	op.write(t, "fail", "[ERROR] account is not signed in\n")
	if _, err := onePasswordFields("acme"); err == nil || err.Error() != "op is signed out" {
		t.Errorf("a locked vault answered %v, want the fixed reason", err)
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
	item, own := slices.Index(once, "OPENAI_API_KEY=fromitem"), slices.Index(once, "OPENAI_API_KEY=mine")
	if item < 0 || own < 0 || item > own {
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

// @scenario "op failures are named in fixed words"
func TestOpFailuresAreNamedInFixedWords(t *testing.T) {
	cases := map[string]string{
		"[ERROR] You are not currently signed in. Please run `op signin` sk-leak": "op is signed out",
		"[ERROR] authorization prompt dismissed sk-leak":                          "op is signed out",
		"[ERROR] the vault is locked sk-leak":                                     "1Password is locked",
		`[ERROR] More than one item matches "LangWatch haven secrets". sk-leak`:   "more than one item has the item's title",
		"[ERROR] no account found for filter acme sk-leak":                        "op does not know the account",
		"panic: something else entirely sk-leak":                                  "op failed",
	}
	for stderr, want := range cases {
		if err := opFailure(stderr, nil); err == nil || err.Error() != want {
			t.Errorf("op saying %q answered %v, want %q", stderr, err, want)
		}
	}
	if err := opFailure(`[ERROR] "x" isn't an item in the "Private" vault.`, nil); !errors.Is(err, errNoItem) {
		t.Errorf("a missing item answered %v, want errNoItem", err)
	}
}

// @scenario "A later start reads the item afresh"
func TestALaterStartReadsTheItemAfresh(t *testing.T) {
	op := stubOnePassword(t)
	op.write(t, "fail", "[ERROR] the vault is locked\n")
	for range 2 {
		if _, err := onePasswordFields("acme"); err == nil {
			t.Fatal("a locked vault answered fields")
		}
	}
	if calls := op.calls(t); len(calls) != 1 {
		t.Fatalf("one launch called op %d times, want once", len(calls))
	}
	if err := os.Remove(filepath.Join(op.dir, "fail")); err != nil {
		t.Fatal(err)
	}
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem"})
	onePasswordCache.Lock()
	read := onePasswordCache.reads["acme"]
	read.at = read.at.Add(-onePasswordBatch)
	onePasswordCache.reads["acme"] = read
	onePasswordCache.Unlock()

	fields, err := onePasswordFields("acme")
	if err != nil || fields["OPENAI_API_KEY"] != "fromitem" {
		t.Errorf("a start after the launch answered %v, %v; want a fresh read", len(fields), err)
	}
}

// @scenario "A fork PR or a play sandbox gets nothing from 1Password"
func TestAnUntrustedCheckoutGetsNothingFromTheItem(t *testing.T) {
	op := stubOnePassword(t)
	op.holds(t, map[string]string{"OPENAI_API_KEY": "fromitem"})
	t.Setenv("OPENAI_API_KEY", "")
	repo := checkoutWithDotenv(t, "LANGWATCH_OP_ACCOUNT=acme\n")

	if env := itemEnvFor(UpParams{WorktreeDir: repo, UntrustedCheckout: true}, []string{"A=1"}); !slices.Equal(env, []string{"A=1"}) {
		t.Errorf("a fork PR's one-shot run got %d entries, want its own env only", len(env))
	}
	if env := itemEnvFor(UpParams{WorktreeDir: repo}, nil); !slices.Contains(env, "OPENAI_API_KEY=fromitem") {
		t.Error("a trusted one-shot run does not get the item")
	}
	lanes := []Child{{Name: APILane}, {Name: GoLane}}
	for _, lane := range readItemAtStart(lanes, domain.Stack{UntrustedCheckout: true}, repo) {
		if lane.SecretsFrom != "" || withSecretsAtStart(lane).EnvAtStart != nil {
			t.Errorf("a fork PR's %s lane reads the item at start", lane.Name)
		}
	}
}

func TestTheUILaneNeverReadsTheItem(t *testing.T) {
	children := readItemAtStart([]Child{{Name: APILane}, {Name: UILane}}, domain.Stack{}, "/repo")

	if api, _ := findChild(children, APILane); api.SecretsFrom != "/repo" {
		t.Error("the api lane does not read the item")
	}
	if ui, _ := findChild(children, UILane); ui.SecretsFrom != "" {
		t.Error("the ui lane, which runs third-party build plugins, reads the item")
	}
}
