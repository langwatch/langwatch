package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The Node lanes run pnpm scripts by name, and platform/app keeps two entry
// points per process: `start:app` / `start:workers` are the PRODUCTION bundles
// (`node dist/server/*.cjs`, built by `pnpm build:server`) and `start:app:dev` /
// `start:workers:dev` run from source through tsx.
//
// Nothing in a dev worktree builds those bundles, so naming the production
// script here is not a slower path — it is a crash loop on MODULE_NOT_FOUND,
// and because the app lane is gated on the API's /api/health probe, the whole
// stack silently never comes up. scripts/start.sh makes the same split off
// NODE_ENV; these lanes bypass start.sh and so must choose for themselves.
//
// This resolves the lane's script name against the real package.json rather
// than comparing the shell string to a literal, so it fails on the thing that
// actually breaks — a lane pointed at a script that loads a build artifact —
// however the scripts are later renamed or restructured.
func TestNodeLanesUseDevEntryPoints(t *testing.T) {
	scripts := appPackageScripts(t)

	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	children := o.planChildren(
		domain.Stack{Slug: "test"},
		PlanOptions{Selection: domain.Selection{Workers: true}},
		t.TempDir(),
		"", // langyDockerHost — the langy lane is not a pnpm lane
	)

	pnpmRun := regexp.MustCompile(`pnpm(?:\s+-\w+)*\s+run\s+([\w:.-]+)`)
	var checked int
	for _, c := range children {
		m := pnpmRun.FindStringSubmatch(c.Shell)
		if m == nil {
			// Skipping silently is how this check would rot: a lane rewritten
			// into a pnpm form this regex cannot read (`pnpm --filter x run y`)
			// would drop out of the loop while the other lane kept `checked`
			// above zero, and the whole guard would go green on an unread lane.
			// So a pnpm lane that cannot be parsed is a failure, not a skip;
			// only genuinely non-pnpm lanes (the Go services, langy) pass here.
			if strings.Contains(c.Shell, "pnpm") {
				t.Errorf("lane %q runs pnpm (%q) in a form this test cannot parse, so its entry point went unchecked; widen pnpmRun", c.Name, c.Shell)
			}
			continue
		}
		name := m[1]
		body, ok := scripts[name]
		if !ok {
			t.Errorf("lane %q runs pnpm script %q, which platform/app/package.json does not define", c.Name, name)
			continue
		}
		checked++
		if strings.Contains(body, "dist/") {
			t.Errorf(
				"lane %q runs %q (%q), which loads a build artifact; dev worktrees never build it, "+
					"so the lane crash-loops on MODULE_NOT_FOUND. Use the :dev entry point.",
				c.Name, name, body,
			)
		}
	}
	if checked == 0 {
		t.Fatal("no pnpm-driven lane was checked; the plan or the shell format changed")
	}
}

// appPackageScripts reads the "scripts" map out of platform/app/package.json,
// found by walking up from this package to the repo root.
func appPackageScripts(t *testing.T) map[string]string {
	t.Helper()

	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("cwd: %v", err)
	}
	var path string
	for {
		candidate := filepath.Join(dir, "platform", "app", "package.json")
		if _, err := os.Stat(candidate); err == nil {
			path = candidate
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not find platform/app/package.json above the test's working directory")
		}
		dir = parent
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return pkg.Scripts
}
