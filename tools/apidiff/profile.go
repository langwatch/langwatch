package apidiff

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Boot profiles: the repo layout changed between main and the branch, so each
// instance boots through a profile carrying its own command argvs, port
// variables, and env injection strategy. Detection keys on the API package's
// package.json name.
//
//   - modular:  apps/api (@langwatch/platform-api), the branch layout.
//     Migrations run through the root scripts and apps/tasks; the API starts
//     with API_PORT on process env (node --env-file never overrides it).
//   - monolith: platform/app (@langwatch/web), the main layout. ClickHouse
//     migration has no root script there; the app starts from source via tsx
//     and its env-load.ts applies .env then .env.portless with override:true,
//     so per-instance values go into platform/app/.env.portless — a file the
//     app reads last, so it wins over any .env copied into the worktree.
const (
	profileModular  = "modular"
	profileMonolith = "monolith"

	// overlayEnvFile is the env overlay path relative to the worktree root on
	// the monolith layout. .env.* is gitignored on main.
	overlayEnvFile = "platform/app/.env.portless"
)

// bootProfile describes how one repo layout migrates, seeds, and starts.
type bootProfile struct {
	name                  string
	prepareArgvs          [][]string // codegen/build steps, run after pnpm install
	prismaMigrateArgv     []string
	clickhouseMigrateArgv []string
	seedArgv              []string
	startArgv             []string
	overlay               bool // write the composed env to overlayEnvFile
}

var (
	// The modular layout runs from source, but packages import built dists
	// (packages/eventing → langwatch/dist, features/hosted-mcp →
	// @langwatch/mcp-server/dist), matching what the dev compose init
	// container builds, so those builds are prepare steps beside prisma
	// generate.
	modularProfile = bootProfile{
		name: profileModular,
		prepareArgvs: [][]string{
			{"--filter", "@langwatch/prisma-client", "run", "prisma:generate"},
			{"--filter", "langwatch", "build"},
			{"--filter", "@langwatch/mcp-server", "run", "build"},
			{"run", "ensure:built"},
		},
		prismaMigrateArgv:     []string{"run", "prisma:migrate"},
		clickhouseMigrateArgv: []string{"run", "clickhouse:migrate"},
		seedArgv:              []string{"run", "prisma:seed"},
		startArgv:             []string{"--filter", "@langwatch/platform-api", "start"},
	}
	monolithProfile = bootProfile{
		name: profileMonolith,
		prepareArgvs: [][]string{
			{"--filter", "@langwatch/web", "prisma:generate:typescript"},
			{"--filter", "langwatch", "build"},
			{"--filter", "@langwatch/mcp-server", "run", "build"},
		},
		prismaMigrateArgv:     []string{"run", "prisma:migrate"},
		clickhouseMigrateArgv: []string{"--filter", "@langwatch/web", "clickhouse:migrate"},
		seedArgv:              []string{"run", "prisma:seed"},
		startArgv:             []string{"--filter", "@langwatch/web", "start:app:dev"},
		overlay:               true,
	}
)

// detectProfile picks the boot profile for a worktree by looking for the two
// known API packages.
func detectProfile(dir string) (bootProfile, error) {
	modular := filepath.Join(dir, "apps", "api", "package.json")
	if name, err := packageName(modular); err == nil && name == "@langwatch/platform-api" {
		return modularProfile, nil
	}
	monolith := filepath.Join(dir, "platform", "app", "package.json")
	if name, err := packageName(monolith); err == nil && name == "@langwatch/web" {
		return monolithProfile, nil
	}
	return bootProfile{}, fmt.Errorf("%s: unrecognized layout (no apps/api @langwatch/platform-api, no platform/app @langwatch/web)", dir)
}

// packageName reads the name field of a package.json.
func packageName(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var manifest struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return "", fmt.Errorf("%s: %w", path, err)
	}
	return manifest.Name, nil
}

// portEnv returns the port variables one profile's start command binds. The
// monolith dev API listens on LANGWATCH_API_PORT when set (PORT+1000
// otherwise); both are pinned to the same allocated port so base-URL
// defaults derived from PORT stay consistent.
func (profile bootProfile) portEnv(port int) []string {
	if profile.name == profileMonolith {
		return []string{fmt.Sprintf("PORT=%d", port), fmt.Sprintf("LANGWATCH_API_PORT=%d", port)}
	}
	return []string{fmt.Sprintf("API_PORT=%d", port)}
}

// extraEnv returns profile-specific variables beyond the shared managed set.
// The monolith's env-create.mjs hard-requires API_TOKEN_JWT_SECRET,
// LANGWATCH_NLP_SERVICE and LANGWATCH_ENDPOINT outside build time; the NLP
// URL is a dead loopback address on BOTH profiles so NLP-dependent endpoints
// fail symmetrically instead of one side being unconfigured.
func (profile bootProfile) extraEnv(baseURL string) []string {
	extra := []string{
		"LANGWATCH_NLP_SERVICE=http://127.0.0.1:5561",
		"LANGWATCH_ENDPOINT=" + baseURL,
	}
	if profile.name == profileMonolith {
		extra = append(extra, "API_TOKEN_JWT_SECRET=apidiff-throwaway-jwt-secret")
	}
	return extra
}

// overlayContent renders the managed subset of a composed environment as a
// dotenv file. NODE_ENV is excluded: env-load.ts treats it as a runtime mode
// that stays shell-only.
func overlayContent(env []string) string {
	managed := map[string]bool{}
	for _, key := range managedEnvKeys {
		managed[key] = true
	}
	delete(managed, "NODE_ENV")
	var content strings.Builder
	content.WriteString("# written by apidiff; scratch worktree overlay\n")
	for _, entry := range env {
		name, _, _ := strings.Cut(entry, "=")
		if managed[name] {
			content.WriteString(entry + "\n")
		}
	}
	return content.String()
}
