package domain_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func writeRegistry(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, domain.SecretRegistryPath)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	body := `{"version":1,"keys":[
		{"key":"OPENAI_API_KEY","class":"secret","dev":"optional"},
		{"key":"DATABASE_URL","class":"composite","dev":"optional"},
		{"key":"GOOGLE_APPLICATION_CREDENTIALS","class":"pointer","dev":"optional"}
	]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	return root
}

func TestSecretsAreMaskedAndConfigIsNot(t *testing.T) {
	classes := domain.SecretClasses(writeRegistry(t))
	if classes == nil {
		t.Fatal("registry did not load")
	}

	if got := domain.MaskEnvValue(classes, "OPENAI_API_KEY", "sk-live-abc"); got != domain.MaskedSecret {
		t.Fatalf("secret not masked: %q", got)
	}
	if got := domain.MaskEnvValue(classes, "BASE_HOST", "http://localhost:5560"); got != "http://localhost:5560" {
		t.Fatalf("config was altered: %q", got)
	}
	if got := domain.MaskEnvValue(classes, "GOOGLE_APPLICATION_CREDENTIALS", "/tmp/key.json"); got != "/tmp/key.json" {
		t.Fatalf("pointer was altered: %q", got)
	}
}

func TestCompositeKeepsShapeAndLosesCredential(t *testing.T) {
	classes := domain.SecretClasses(writeRegistry(t))

	got := domain.MaskEnvValue(classes, "DATABASE_URL",
		"postgresql://app:hunter2@db.internal:5432/langwatch?sslmode=require")

	if got != "postgresql://db.internal:5432/langwatch" {
		t.Fatalf("composite masking: %q", got)
	}
}

func TestAnUnreadableRegistryStillMasksByName(t *testing.T) {
	classes := domain.SecretClasses(t.TempDir())
	if classes != nil {
		t.Fatal("expected no registry")
	}

	if got := domain.MaskEnvValue(classes, "LW_GATEWAY_JWT_SECRET", "abc"); got != domain.MaskedSecret {
		t.Fatalf("fallback did not mask: %q", got)
	}
	if got := domain.MaskEnvValue(classes, "BASE_HOST", "http://localhost:5560"); got != "http://localhost:5560" {
		t.Fatalf("fallback altered config: %q", got)
	}
}
