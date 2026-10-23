package nodeprofile

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

const root = "/repo"

func near(t *testing.T, what string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.01 {
		t.Errorf("%s = %.3f, want %.3f", what, got, want)
	}
}

func loadCPU(t *testing.T, name string) CPUAnalysis {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	p, err := ParseCPUProfile(raw)
	if err != nil {
		t.Fatal(err)
	}
	return AnalyseCPU(p, root)
}

func rowNamed(rows []Row, name string) (Row, bool) {
	for _, r := range rows {
		if r.Name == name {
			return r, true
		}
	}
	return Row{}, false
}

// @scenario "A CPU profile is saved with a summary"
func TestAnalyseCPU_HeaderSharesComeFromSampleTimes(t *testing.T) {
	a := loadCPU(t, "before.cpuprofile")
	if a.Samples != 15 {
		t.Errorf("samples = %d, want 15", a.Samples)
	}
	near(t, "duration ms", a.DurationMs, 16)
	near(t, "interval us", a.IntervalUs, 1000)
	near(t, "idle %", a.IdlePct, 100*4.0/15)
	near(t, "busy %", a.BusyPct, 100*11.0/15)
	near(t, "gc %", a.GCPct, 100*1.0/15)
	near(t, "program %", a.ProgramPct, 100*1.0/15)
	if _, ok := rowNamed(a.ByFunction, "(idle)"); ok {
		t.Error("(idle) is listed as a function; it is the header's idle share, not work")
	}
}

// @scenario "A CPU profile is saved with a summary"
func TestAnalyseCPU_SelfTimeByFunctionNamesFileAndLine(t *testing.T) {
	a := loadCPU(t, "before.cpuprofile")
	top := a.ByFunction[0]
	if top.Name != "handle" || top.Where != "modules/traces/process/src/services/ingest.service.ts:42" {
		t.Errorf("top function = %+v, want handle at its repository path, line 42, without the ?lw= stamp", top)
	}
	near(t, "handle ms", top.Ms, 3)
	near(t, "handle %", top.Pct, 20)
	parse, _ := rowNamed(a.ByFunction, "parse")
	if parse.Where != "zod/lib/types.js:100" {
		t.Errorf("a dependency's frame reads %q, want it under its package name", parse.Where)
	}
	walk, _ := rowNamed(a.ByFunction, "walk")
	near(t, "walk self ms (two nodes, one frame)", walk.Ms, 2)
}

// @scenario "A CPU profile is saved with a summary"
func TestAnalyseCPU_PackageRollupCollapsesPnpmAndWorkspacePaths(t *testing.T) {
	a := loadCPU(t, "before.cpuprofile")
	want := map[string]float64{"apps/api": 3, "modules/traces": 3, "zod": 2, "(native)": 1, "(gc)": 1, "(program)": 1}
	if len(a.ByPackage) != len(want) {
		t.Errorf("packages = %+v, want %v", a.ByPackage, want)
	}
	for name, ms := range want {
		r, ok := rowNamed(a.ByPackage, name)
		if !ok {
			t.Errorf("no package %q in %+v", name, a.ByPackage)
			continue
		}
		near(t, name+" ms", r.Ms, ms)
	}
}

// @scenario "A CPU profile is saved with a summary"
func TestAnalyseCPU_InclusiveCountsARecursiveFrameOncePerSample(t *testing.T) {
	a := loadCPU(t, "before.cpuprofile")
	for name, ms := range map[string]float64{"main": 9, "parse": 3, "walk": 2, "handle": 3} {
		r, ok := rowNamed(a.Inclusive, name)
		if !ok {
			t.Errorf("no inclusive row for %s", name)
			continue
		}
		near(t, name+" inclusive ms", r.Ms, ms)
	}
	if _, ok := rowNamed(a.Inclusive, "(root)"); ok {
		t.Error("(root) is listed as inclusive time")
	}
	if got := a.Top(2); len(got.ByFunction) != 2 || len(got.Inclusive) != 2 {
		t.Errorf("Top(2) kept %d and %d rows", len(got.ByFunction), len(got.Inclusive))
	}
}

// @scenario "Two CPU profiles compare"
func TestCompare_DeltasSortByBiggestChangeAndSurviveAMovedLine(t *testing.T) {
	c := Compare(loadCPU(t, "before.cpuprofile"), loadCPU(t, "after.cpuprofile"))
	near(t, "busy delta pt", c.BusyDelta, 50-100*11.0/15)
	near(t, "gc delta pt", c.GCDelta, -100*1.0/15)
	order := []string{"walk", "handle", "(garbage collector)", "JSON.parse", "parse"}
	for i, name := range order {
		if c.ByFunction[i].Name != name {
			t.Fatalf("function %d = %s, want %s (order %v)", i, c.ByFunction[i].Name, name, order)
		}
	}
	handles := 0
	for _, d := range c.ByFunction {
		if d.Name == "handle" {
			handles++
			near(t, "handle before %", d.BeforePct, 20)
			near(t, "handle after %", d.AfterPct, 10)
			near(t, "handle change pt", d.DeltaPct, -10)
			if d.Where != "modules/traces/process/src/services/ingest.service.ts:48" {
				t.Errorf("handle reads at %q, want the after profile's line", d.Where)
			}
		}
	}
	if handles != 1 {
		t.Errorf("handle appears %d times; a moved line must still match itself", handles)
	}
	zod := c.ByPackage[0]
	for _, d := range c.ByPackage {
		if d.Name == "zod" {
			zod = d
		}
	}
	near(t, "zod change pt", zod.DeltaPct, 20-100*2.0/15)
}

// @scenario "A CPU profile is saved with a summary"
func TestPackageOfAndDisplayPath(t *testing.T) {
	cases := []struct{ url, fn, pkg, display string }{
		{"file:///repo/node_modules/.pnpm/@opentelemetry+api@1.9.0/node_modules/@opentelemetry/api/build/x.js", "f", "@opentelemetry/api", "@opentelemetry/api/build/x.js"},
		{"file:///repo/node_modules/ioredis/built/a.js", "f", "ioredis", "ioredis/built/a.js"},
		{"node:internal/streams/readable", "f", "node", "node:internal/streams/readable"},
		{"file:///repo/enterprise/modules/sso/process/src/a.ts", "f", "enterprise/modules/sso", "enterprise/modules/sso/process/src/a.ts"},
		{"file:///repo/packages/api/src/door.ts?lw=3", "f", "packages/api", "packages/api/src/door.ts"},
		{"file:///elsewhere/lib/thing.js", "f", "/elsewhere/lib", "/elsewhere/lib/thing.js"},
		{"wasm://wasm/00d1cb12", "f", "wasm", "wasm://wasm/00d1cb12"},
		{"", "(garbage collector)", "(gc)", ""},
		{"", "JSON.parse", "(native)", ""},
	}
	for _, c := range cases {
		if got := PackageOf(c.url, c.fn, root); got != c.pkg {
			t.Errorf("PackageOf(%q) = %q, want %q", c.url, got, c.pkg)
		}
		if got := DisplayPath(c.url, root); got != c.display {
			t.Errorf("DisplayPath(%q) = %q, want %q", c.url, got, c.display)
		}
	}
}

// @scenario "A heap profile is sampled or snapshotted"
func TestAnalyseHeap_SumsSampledBytesByFunctionAndPackage(t *testing.T) {
	raw, err := os.ReadFile("testdata/small.heapprofile")
	if err != nil {
		t.Fatal(err)
	}
	p, err := ParseHeapProfile(raw)
	if err != nil {
		t.Fatal(err)
	}
	a := AnalyseHeap(p, root)
	near(t, "total MB", a.TotalMB, 5)
	if a.ByFunction[0].Name != "decode" || a.ByFunction[0].Where != "protobufjs/src/reader.js:11" {
		t.Errorf("top function = %+v, want decode in protobufjs, both nodes summed", a.ByFunction[0])
	}
	near(t, "decode MB", a.ByFunction[0].MB, 4)
	near(t, "decode %", a.ByFunction[0].Pct, 80)
	if a.ByFunction[1].Name != "(anonymous)" {
		t.Errorf("an unnamed function reads %q, want (anonymous)", a.ByFunction[1].Name)
	}
	if a.ByPackage[0].Name != "protobufjs" || a.ByPackage[1].Name != "modules/traces" {
		t.Errorf("packages = %+v", a.ByPackage)
	}
}

// @scenario "A heap profile is sampled or snapshotted"
func TestAnalyseSnapshot_RetainedStringsAndDuplicatePackages(t *testing.T) {
	raw, err := os.ReadFile("testdata/small.heapsnapshot")
	if err != nil {
		t.Fatal(err)
	}
	s, err := ParseHeapSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	a, err := AnalyseSnapshot(s, 10)
	if err != nil {
		t.Fatal(err)
	}
	if a.Nodes != 5 {
		t.Errorf("nodes = %d, want 5", a.Nodes)
	}
	near(t, "total MB", a.TotalMB, 2000140.0/mib)
	retained := map[string]float64{}
	for _, r := range a.RetainedByConstructor {
		retained[r.Name] = r.MB * mib
	}
	near(t, "Map retained bytes", retained["Map"], 2000100)
	// The plain string is reached weakly from the root and strongly from Foo,
	// so Foo dominates it: a weak edge holds nothing alive.
	near(t, "Foo retained bytes", retained["Foo"], 40)
	if len(a.TopRetained) != 2 || a.TopRetained[0].Name != "Map" || a.TopRetained[1].Path != "c Map" || a.TopRetained[0].Path != "(a GC root)" {
		t.Errorf("top retained = %+v", a.TopRetained)
	}
	st := a.Strings
	if st.Count != 2 || st.TwoByteCount != 1 {
		t.Errorf("strings = %+v, want 2 with 1 two-byte", st)
	}
	near(t, "two-byte bytes", st.TwoByteMB*mib, 2000000)
	if !st.Biggest[0].TwoByte || st.Biggest[1].TwoByte {
		t.Errorf("two-byte flags = %+v", st.Biggest)
	}
	if st.Biggest[1].Preview != "plain string with space" {
		t.Errorf("preview = %q, want whitespace collapsed", st.Biggest[1].Preview)
	}
	if len(a.DuplicatePackages) != 1 || a.DuplicatePackages[0].Name != "zod" || len(a.DuplicatePackages[0].Dirs) != 2 {
		t.Errorf("duplicate packages = %+v, want zod from two directories", a.DuplicatePackages)
	}
}

func TestParseHeapSnapshot_RefusesWhatIsNotOne(t *testing.T) {
	for _, raw := range []string{"", "[]", `{"nodes":[1,2`, `{"strings":[]}`} {
		if _, err := ParseHeapSnapshot([]byte(raw)); err == nil {
			t.Errorf("ParseHeapSnapshot(%q) accepted it", raw)
		}
	}
}

// @scenario "Two CPU profiles compare"
func TestGuessRoot_IsWhereMostDependenciesLoadFrom(t *testing.T) {
	urls := []string{
		"file:///wt/a/node_modules/.pnpm/zod@3/node_modules/zod/x.js",
		"file:///wt/a/node_modules/.pnpm/pg@8/node_modules/pg/y.js",
		"file:///wt/a/packages/api/node_modules/local/z.js",
		"file:///wt/a/modules/traces/s.ts",
		"node:net",
	}
	if got := GuessRoot(urls); got != "/wt/a" {
		t.Errorf("GuessRoot = %q, want /wt/a", got)
	}
	if got := GuessRoot([]string{"node:net"}); got != "" {
		t.Errorf("GuessRoot with no dependency = %q, want empty", got)
	}
}
