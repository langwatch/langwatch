package apidiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writePackageJSON(t *testing.T, dir, name string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	content := `{"name": "` + name + `"}`
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDetectProfileModular(t *testing.T) {
	dir := t.TempDir()
	writePackageJSON(t, filepath.Join(dir, "apps", "api"), "@langwatch/platform-api")
	profile, err := detectProfile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if profile.name != profileModular {
		t.Fatalf("profile = %q, want modular", profile.name)
	}
	if profile.overlay {
		t.Fatal("modular profile must not use an env overlay")
	}
}

func TestDetectProfileMonolith(t *testing.T) {
	dir := t.TempDir()
	writePackageJSON(t, filepath.Join(dir, "platform", "app"), "@langwatch/web")
	profile, err := detectProfile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if profile.name != profileMonolith || !profile.overlay {
		t.Fatalf("profile = %+v, want monolith with overlay", profile)
	}
}

func TestDetectProfileUnknown(t *testing.T) {
	dir := t.TempDir()
	writePackageJSON(t, filepath.Join(dir, "apps", "api"), "@example/other")
	if _, err := detectProfile(dir); err == nil {
		t.Fatal("unknown layout must error")
	}
	if _, err := detectProfile(t.TempDir()); err == nil {
		t.Fatal("empty dir must error")
	}
}

func TestProfileCommandArgvs(t *testing.T) {
	if got := strings.Join(modularProfile.startArgv, " "); got != "--filter @langwatch/platform-api start" {
		t.Fatalf("modular start = %q", got)
	}
	if got := strings.Join(monolithProfile.startArgv, " "); got != "--filter @langwatch/web start:app:dev" {
		t.Fatalf("monolith start = %q", got)
	}
	if got := strings.Join(monolithProfile.clickhouseMigrateArgv, " "); got != "--filter @langwatch/web clickhouse:migrate" {
		t.Fatalf("monolith clickhouse migrate = %q", got)
	}
	if got := strings.Join(modularProfile.clickhouseMigrateArgv, " "); got != "run clickhouse:migrate" {
		t.Fatalf("modular clickhouse migrate = %q", got)
	}
}

func TestProfilePortEnv(t *testing.T) {
	modular := modularProfile.portEnv(6560)
	if len(modular) != 1 || modular[0] != "API_PORT=6560" {
		t.Fatalf("modular portEnv = %v", modular)
	}
	monolith := monolithProfile.portEnv(6560)
	if len(monolith) != 2 || monolith[0] != "PORT=6560" || monolith[1] != "LANGWATCH_API_PORT=6560" {
		t.Fatalf("monolith portEnv = %v", monolith)
	}
}

func TestProfileExtraEnv(t *testing.T) {
	monolith := monolithProfile.extraEnv("http://127.0.0.1:6560")
	joined := strings.Join(monolith, "\n")
	for _, want := range []string{"API_TOKEN_JWT_SECRET=", "LANGWATCH_NLP_SERVICE=http://127.0.0.1:5561", "LANGWATCH_ENDPOINT=http://127.0.0.1:6560"} {
		if !strings.Contains(joined, want) {
			t.Errorf("monolith extraEnv missing %q:\n%s", want, joined)
		}
	}
	modular := modularProfile.extraEnv("http://127.0.0.1:6560")
	if strings.Contains(strings.Join(modular, "\n"), "API_TOKEN_JWT_SECRET") {
		t.Fatalf("modular extraEnv must not carry the monolith-only JWT secret: %v", modular)
	}
	if len(modular) != len(monolith)-1 {
		t.Fatalf("modular extraEnv = %v, want the shared pair only", modular)
	}
}

func TestOverlayContent(t *testing.T) {
	env := []string{
		"HOME=/home/user",
		"NODE_ENV=development",
		"DATABASE_URL=postgres://prisma:prisma@127.0.0.1:55432/apidiff_main",
		"CLICKHOUSE_URL=http://default:langwatch@127.0.0.1:58123/apidiff_main",
		"REDIS_URL=redis://127.0.0.1:56379",
		"REDIS_DB_INDEX=15",
		"PORT=6560",
		"LANGWATCH_API_PORT=6560",
		"CREDENTIALS_SECRET=" + throwawayCredentialsSecret,
		"NEXTAUTH_SECRET=" + throwawayNextAuthSecret,
		"BASE_HOST=http://localhost:6560",
	}
	content := overlayContent(env)
	if strings.Contains(content, "HOME") || strings.Contains(content, "NODE_ENV") {
		t.Fatalf("overlay must carry managed keys only, no NODE_ENV:\n%s", content)
	}
	for _, want := range []string{"DATABASE_URL=postgres", "CLICKHOUSE_URL=http", "REDIS_DB_INDEX=15", "LANGWATCH_API_PORT=6560", "BASE_HOST"} {
		if !strings.Contains(content, want) {
			t.Errorf("overlay missing %q:\n%s", want, content)
		}
	}
}
