package app

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
				op.write(t, "item.json", `{"id":"abc","title":"LangWatch haven secrets","category":"SECURE_NOTE","fields":[`+
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

// @scenario "The move stops before 1Password when .env cannot be read"
func TestAnUnterminatedQuoteStopsTheMoveBeforeOp(t *testing.T) {
	op := stubOnePassword(t)
	broken := "OPENAI_API_KEY=sk-openai-value\nGITHUB_APP_PRIVATE_KEY=\"secret-tail\n"
	repo := checkoutWithDotenv(t, broken)

	err := (&Orchestrator{}).SecretsMove(SecretsMoveParams{WorktreeDir: repo, Account: "acme", Apply: true}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "nothing moved") || strings.Contains(err.Error(), "secret-tail") {
		t.Fatalf("an unterminated quote answered %v", err)
	}
	if calls := op.calls(t); calls != nil {
		t.Errorf("op was called over a .env that could not be read: %v", calls)
	}
	if raw, _ := os.ReadFile(filepath.Join(repo, ".env")); string(raw) != broken {
		t.Error(".env was changed")
	}
}

// @scenario "The move stops before 1Password when .env cannot be read"
func TestADotenvEditedDuringTheMoveIsNeverOverwritten(t *testing.T) {
	repo := checkoutWithDotenv(t, "OPENAI_API_KEY=x\nMINE=new\n")
	path := filepath.Join(repo, ".env")
	if err := replaceIfUnchanged(path, "OPENAI_API_KEY=x\n", "rewritten\n"); err == nil || !strings.Contains(err.Error(), "changed while the move ran") {
		t.Fatalf("a .env edited meanwhile answered %v", err)
	}
	if raw, _ := os.ReadFile(path); string(raw) != "OPENAI_API_KEY=x\nMINE=new\n" {
		t.Error("the edited .env was overwritten")
	}
	if err := replaceIfUnchanged(path, "OPENAI_API_KEY=x\nMINE=new\n", "MINE=new\n"); err != nil {
		t.Fatal(err)
	}
}
