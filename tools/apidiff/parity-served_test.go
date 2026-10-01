package apidiff

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func servedRoutes(lines ...string) []ServedRoute {
	routes := make([]ServedRoute, 0, len(lines))
	for _, line := range lines {
		method, path, _ := strings.Cut(line, " ")
		routes = append(routes, ServedRoute{Method: method, Path: path, Source: "src/" + strings.Trim(path, "/*")})
	}
	return routes
}

func servedKeys[T any](rows []T, key func(T) string) []string {
	keys := make([]string, 0, len(rows))
	for _, row := range rows {
		keys = append(keys, key(row))
	}
	slices.Sort(keys)
	return keys
}

func gapKey(gap ServedGap) string { return gap.Method + " " + gap.Path + " " + gap.Module }

func TestDiffServedRoutesReportsUndocumentedRoutesTheBranchDoesNotServe(t *testing.T) {
	main := servedRoutes(
		"GET /api/langy/ui/actions",
		"POST /api/webhooks/stripe",
		"GET /api/prompts/:id{.+}/versions",
		"HEAD /api/files/:id",
		"GET /api/v1/traces/:id",
		"POST /api/auth/sign-in/email",
		"ALL /api/auth/*",
		"ALL /api/trpc/*",
		"ALL /api/roles/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}/*",
		"POST /api/v1/langy/control/2026-08-27/requests",
		"GET /api/projects",
		"POST /api/dataset/direct-upload",
		"GET /llms.txt",
		"GET /llms.txt/",
		"ALL /api/unsubscribe",
		"ALL /api/sample-wildcard/v3/*",
	)
	branch := servedRoutes(
		"GET /api/prompts/:promptId/versions",
		"GET /api/files/:fileId",
		"GET /api/traces/:traceId",
		"ALL /api/auth/*",
		"ALL /api/unsubscribe",
		"ALL /api/v1/unsubscribe",
		"POST /api/evaluations/v3/execute",
	)
	asked := []string{}
	comparison := ServedComparison{
		Documented: DocumentedRoutes(restDocument(`{"/api/projects": {"get": {"responses": {}}}, "/api/dataset/direct-upload": {"post": {"responses": {}}}}`)),
		ModuleOf: func(method, path string) string {
			asked = append(asked, method+" "+path)
			if strings.Contains(path, "langy") {
				return "langy"
			}
			return unownedModule
		},
	}

	parity := DiffServedRoutes(main, branch, comparison)

	wantMissing := []string{
		"ALL /api/sample-wildcard/v3/* (unowned)",
		"GET /api/langy/ui/actions langy",
		"GET /llms.txt (unowned)",
		"POST /api/webhooks/stripe (unowned)",
	}
	if got := servedKeys(parity.Missing, gapKey); !slices.Equal(got, wantMissing) {
		t.Errorf("missing = %v, want %v", got, wantMissing)
	}
	if got := servedKeys(parity.Retired, gapKey); !slices.Equal(got, []string{"POST /api/dataset/direct-upload (unowned)"}) {
		t.Errorf("retired = %v", got)
	}
	reasons := map[string]string{}
	for _, ignored := range parity.Ignored {
		reasons[ignored.Method+" "+ignored.Path] = ignored.Reason
	}
	for route, want := range map[string]string{
		"ALL /api/auth/*": ignoreBetterAuth,
		"ALL /api/trpc/*": ignoreTrpcLanes,
		"ALL /api/roles/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}/*": ignoreVersionMount,
		"POST /api/v1/langy/control/2026-08-27/requests":                      ignoreVersionMount,
		"GET /api/projects": ignoreDocumented,
	} {
		if reasons[route] != want {
			t.Errorf("ignored %s = %q, want %q", route, reasons[route], want)
		}
	}
	if parity.MainCount != 15 || parity.BranchCount != 6 {
		t.Errorf("counts = main %d branch %d", parity.MainCount, parity.BranchCount)
	}
	if !slices.Contains(asked, "GET /api/langy/ui/actions") {
		t.Errorf("modules asked for %v", asked)
	}
}

func TestServedRouteSpellings(t *testing.T) {
	cases := map[string][2]string{
		"/api/prompts/:id{.+?}/tags/:tag": {"/api/prompts/{}/tags/{}", "/api/prompts/{id}/tags/{tag}"},
		"/api/v1/files/:id?":              {"/api/files/{}", "/api/files/{id}"},
		"/api/projects/{projectId}":       {"/api/projects/{}", "/api/projects/{projectId}"},
		"/llms.txt/":                      {"/llms.txt", "/llms.txt"},
		"/":                               {"/", "/"},
	}
	for path, want := range cases {
		if got := routeKey(path); got != want[0] {
			t.Errorf("routeKey(%q) = %q, want %q", path, got, want[0])
		}
		if got := openAPIPath(path); got != want[1] {
			t.Errorf("openAPIPath(%q) = %q, want %q", path, got, want[1])
		}
	}
	for path, want := range map[string]bool{
		"/api/v1/agents/:apiVersion{latest|preview}": true,
		"/api/langy/control/latest/requests":         true,
		"/api/organization/2026-08-07/members":       true,
		"/api/traces/:traceId":                       false,
		"/latest":                                    false,
	} {
		if got := versionMountRoute(path); got != want {
			t.Errorf("versionMountRoute(%q) = %v", path, got)
		}
	}
}

func TestServedOnlyRoutesCountAndRenderInPackets(t *testing.T) {
	report := ParityReport{MainRef: "origin/main", ServedOnly: &ServedParity{
		MainCount: 3, BranchCount: 1,
		Missing: []ServedGap{{Method: "POST", Path: "/api/langy/ui/actions", Source: "platform/app/src/server/routes/langy-ui-actions", Module: "langy"}},
		Retired: []ServedGap{{Method: "POST", Path: "/api/dataset/direct-upload", Source: "platform/app/src/app/api/dataset", Module: "dataset"}},
		Ignored: []IgnoredRoute{{Method: "ALL", Path: "/api/auth/*", Reason: ignoreBetterAuth}},
	}}
	report.Modules = moduleCounts(report)
	if len(report.Modules) != 1 || report.Modules[0].Module != "langy" || report.Modules[0].Missing != 1 {
		t.Fatalf("modules = %+v", report.Modules)
	}
	packet := renderPacket(report, "langy")
	for _, want := range []string{"## Served on main, not on the branch (1)", "| `POST /api/langy/ui/actions` | platform/app/src/server/routes/langy-ui-actions |"} {
		if !strings.Contains(packet, want) {
			t.Errorf("packet missing %q:\n%s", want, packet)
		}
	}
	if retired := renderPacket(report, "dataset"); !strings.Contains(retired, "## Ruled retired served routes, not defects") {
		t.Errorf("dataset packet:\n%s", retired)
	}
	var table strings.Builder
	if err := WriteParityTable(&table, report); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"served routes main 3 / branch 1", "served on main only 1, ruled retired 1, ignored 1"} {
		if !strings.Contains(table.String(), want) {
			t.Errorf("table missing %q:\n%s", want, table.String())
		}
	}
}

func TestRouteInventoryPicksTheLayoutRunsAndRemovesTheScript(t *testing.T) {
	cases := map[string]struct{ marker, subdir, command string }{
		"branch": {"packages/installed-server-modules/src/server-modules.generated.ts", "packages/api", "node"},
		"main":   {"platform/app/src/server/api-router.ts", "platform/app", "pnpm"},
	}
	for side, layout := range cases {
		dir := t.TempDir()
		marker := filepath.Join(dir, filepath.FromSlash(layout.marker))
		if err := os.MkdirAll(filepath.Dir(marker), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(dir, layout.subdir), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(marker, nil, 0o600); err != nil {
			t.Fatal(err)
		}
		out := filepath.Join(t.TempDir(), "routes.json")
		var seen commandSpec
		fake := func(_ context.Context, spec commandSpec, _ io.Writer) error {
			seen = spec
			if _, err := os.Stat(filepath.Join(spec.dir, routeScriptName)); err != nil {
				t.Errorf("%s: script not written before the run: %v", side, err)
			}
			return os.WriteFile(out, []byte(`{"side":"`+side+`","routes":[{"method":"POST","path":"/api/webhooks/stripe","source":"s"}]}`), 0o600)
		}
		manifest, err := routeInventory{run: fake, inherit: []string{"PATH=/bin"}, log: io.Discard}.collect(context.Background(), dir, out)
		if err != nil {
			t.Fatal(err)
		}
		if len(manifest.Routes) != 1 || manifest.Routes[0].Path != "/api/webhooks/stripe" {
			t.Errorf("%s: manifest = %+v", side, manifest)
		}
		workDir := filepath.Join(dir, layout.subdir)
		if seen.dir != workDir || seen.name != layout.command || !slices.Contains(seen.env, "SKIP_ENV_VALIDATION=1") {
			t.Errorf("%s: spec = %+v", side, seen)
		}
		if _, err := os.Stat(filepath.Join(workDir, routeScriptName)); !os.IsNotExist(err) {
			t.Errorf("%s: script left behind in the worktree: %v", side, err)
		}
	}
	if _, err := (routeInventory{}).collect(context.Background(), t.TempDir(), "out.json"); err == nil {
		t.Error("a checkout with no router was accepted")
	}
}
