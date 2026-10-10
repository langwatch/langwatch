package domain_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// declareSecret writes one contract file under a fake checkout root so
// SecretClasses's scan has something to find, the same shape a real module
// contract uses: `Secret.load("ID", { optional: true })`.
func declareSecret(t *testing.T, id string) string {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "modules", "widget", "contract", "src", "widget.config.ts")
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	body := `import { Secret } from "@langwatch/secrets";
export const widgetSecrets = {
  key: Secret.load("` + id + `", { optional: true }),
};
`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	return root
}

func TestADeclaredSecretIsMaskedAndConfigIsNot(t *testing.T) {
	classes := domain.SecretClasses(declareSecret(t, "WIDGET_SIGNING_KEY"))

	if got := domain.MaskEnvValue(classes, "WIDGET_SIGNING_KEY", "sk-live-abc"); got != domain.MaskedSecret {
		t.Fatalf("declared secret not masked: %q", got)
	}
	if got := domain.MaskEnvValue(classes, "BASE_HOST", "http://localhost:5560"); got != "http://localhost:5560" {
		t.Fatalf("config was altered: %q", got)
	}
}

func TestADeclaredConnectionStringKeepsShapeAndLosesCredential(t *testing.T) {
	classes := domain.SecretClasses(declareSecret(t, "DATABASE_URL"))

	got := domain.MaskEnvValue(classes, "DATABASE_URL",
		"postgresql://app:hunter2@db.internal:5432/langwatch?sslmode=require")

	if got != "postgresql://db.internal:5432/langwatch" {
		t.Fatalf("connection-string masking: %q", got)
	}
}

func TestADeclaredNonURLSecretIsBlankedNotPassedThrough(t *testing.T) {
	// GOOGLE_APPLICATION_CREDENTIALS is a Secret.load handle whose value is a
	// file path, not a connection string: no host to keep, so it is blanked
	// outright rather than printed verbatim.
	classes := domain.SecretClasses(declareSecret(t, "GOOGLE_APPLICATION_CREDENTIALS"))

	got := domain.MaskEnvValue(classes, "GOOGLE_APPLICATION_CREDENTIALS", "/tmp/key.json")
	if got != domain.MaskedSecret {
		t.Fatalf("non-URL secret was not blanked: %q", got)
	}
}

func TestNameShapeCatchesWhatNoDeclarationScanned(t *testing.T) {
	// An empty checkout: nothing to scan, only the haven-seeded keys apply —
	// the name-shape heuristic must still catch a plain undeclared secret.
	classes := domain.SecretClasses(t.TempDir())

	if got := domain.MaskEnvValue(classes, "LW_GATEWAY_JWT_SECRET", "abc"); got != domain.MaskedSecret {
		t.Fatalf("name-shape fallback did not mask: %q", got)
	}
	if got := domain.MaskEnvValue(classes, "BASE_HOST", "http://localhost:5560"); got != "http://localhost:5560" {
		t.Fatalf("name-shape fallback altered config: %q", got)
	}
}

func TestNameShapeAppliesEvenWithDeclarationsPresent(t *testing.T) {
	// The bug this guards: once a declared-secrets map exists, an unlisted
	// key must not fall through to "config" just because the map is
	// non-nil — the name-shape layer stays live alongside the declared one.
	classes := domain.SecretClasses(declareSecret(t, "WIDGET_SIGNING_KEY"))

	if got := domain.MaskEnvValue(classes, "SOME_OTHER_API_KEY", "sk-live-xyz"); got != domain.MaskedSecret {
		t.Fatalf("name-shape layer was shadowed by the declared layer: %q", got)
	}
}

func TestHavenSeededDevCredentialsAreMaskedEvenWithNoDeclaration(t *testing.T) {
	// These never go through Secret.load — a seed script reads them straight
	// off process.env — so only haven's own known-key list catches them.
	classes := domain.SecretClasses(t.TempDir())

	for _, key := range []string{
		"HAVEN_SEED_LANGWATCH_API_KEY",
		"LANGWATCH_ADMIN_PASSWORD",
		"LANGWATCH_PRIVATE_ACCESS_TOKEN",
		"LANGWATCH_PUBLIC_ACCESS_TOKEN",
	} {
		if got := domain.MaskEnvValue(classes, key, "value"); got != domain.MaskedSecret {
			t.Fatalf("haven-seeded credential %s not masked: %q", key, got)
		}
	}
}

func TestSecretClassesNeverReadsTheDeletedRegistry(t *testing.T) {
	// packages/secrets/keys.json is a deleted spelling (ARCHITECTURE.md §15):
	// a checkout that still has one lying around (a stale worktree, an old
	// branch) must not be trusted over the live source scan.
	root := t.TempDir()
	registryPath := filepath.Join(root, "packages", "secrets", "keys.json")
	if err := os.MkdirAll(filepath.Dir(registryPath), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(registryPath, []byte(`{"keys":[{"key":"BASE_HOST","class":"secret"}]}`), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	classes := domain.SecretClasses(root)
	if got := domain.MaskEnvValue(classes, "BASE_HOST", "http://localhost:5560"); got != "http://localhost:5560" {
		t.Fatalf("a stray keys.json was read: %q", got)
	}
}
