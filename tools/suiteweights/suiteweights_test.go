package suiteweights

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const jobLog = "2026-10-28T11:55:47.3024497Z Shard 2/8: 28 of 236 packages, about 973s of suites.\n" +
	"2026-10-28T11:56:37.5236632Z ##[group]@langwatch/analytics-process (modules/analytics/process) — pnpm run test (50s)\n" +
	"2026-10-28T11:56:37.6Z  RUN  v5.0.1\n" +
	"2026-10-28T11:56:37.7Z ##[endgroup]\n" +
	"2026-10-28T12:02:19.0287095Z ##[group]@langwatch/analytics-process (modules/analytics/process) — pnpm run test:integration (342s)\n" +
	"2026-10-28T12:10:03.1754076Z ##[group]@langwatch/span-normalisation (packages/span-normalisation) — pnpm run test (4s)\n" +
	"2026-10-28T12:10:03.1765728Z ##[group]⏩ > nx run @langwatch/span-normalisation:test  [existing outputs match the cache, left as is]\n" +
	"2026-10-28T12:10:03.1889928Z \x1b[1mNx read the output from the cache instead of running the command for 1 out of 1 tasks.\x1b[22m\n" +
	"2026-10-28T12:11:00.0Z ##[group]@langwatch/cut-short (packages/cut-short) — pnpm run test (unfinished)\n"

// @scenario "A script's seconds are read from the job log"
func TestParseJobLogMeasuresEachScript(t *testing.T) {
	got := ParseJobLog(jobLog)

	assert.Equal(t, []Measurement{
		{Package: "@langwatch/analytics-process", Script: "test", Seconds: 50},
		{Package: "@langwatch/analytics-process", Script: "test:integration", Seconds: 342},
		{Package: "@langwatch/span-normalisation", Script: "test", Seconds: 4, Cached: true},
	}, got)
}

func m(pkg, script string, seconds float64, cached bool) Measurement {
	return Measurement{Package: pkg, Script: script, Seconds: seconds, Cached: cached}
}

func k(pkg, script string) ScriptKey { return ScriptKey{Package: pkg, Script: script} }

func allDefined(ScriptKey) bool { return true }

// @scenario "A suite Nx replayed from its cache does not make it look cheap"
func TestWeighIgnoresCacheReplaysWhenARealRunExists(t *testing.T) {
	weights := Weigh([][]Measurement{
		{m("a", "test", 2, true)},
		{m("a", "test", 90, false)},
		{m("a", "test", 3, true)},
	}, nil, allDefined)

	assert.InDelta(t, 90.0, weights[k("a", "test")], 0.001)
}

// @scenario "A suite only ever replayed from the cache still has a weight"
func TestWeighFallsBackToReplaysWhenNothingRanForReal(t *testing.T) {
	weights := Weigh([][]Measurement{{m("a", "test", 4, true)}, {m("a", "test", 6, true)}}, nil, allDefined)

	assert.InDelta(t, 5.0, weights[k("a", "test")], 0.001)
}

// @scenario "A package only ever replayed from the cache keeps its committed weight"
func TestWeighKeepsTheCommittedWeightOfAPackageNoRunExecuted(t *testing.T) {
	previous := ParseWeights("# header\n@x/sims  test  28\n@x/sims  test:browser  12\n@x/ran  test  90  # note\n")

	weights := Weigh([][]Measurement{
		{m("@x/sims", "test", 2, true), m("@x/ran", "test", 40, false)},
		{m("@x/sims", "test", 3, true), m("@x/ran", "test", 50, false)},
	}, previous, allDefined)

	assert.InDelta(t, 28.0, weights[k("@x/sims", "test")], 0.001)
	assert.InDelta(t, 12.0, weights[k("@x/sims", "test:browser")], 0.001)
	assert.InDelta(t, 45.0, weights[k("@x/ran", "test")], 0.001)
}

// @scenario "A script no run measured keeps its committed weight"
func TestWeighKeepsAScriptNoRunExecutedWhenItsPackageRan(t *testing.T) {
	previous := ParseWeights("@x/app  test  30\n@x/app  test:browser  70\n@x/gone  test  20\n")

	weights := Weigh([][]Measurement{{m("@x/app", "test", 40, false)}}, previous, allDefined)

	assert.InDelta(t, 40.0, weights[k("@x/app", "test")], 0.001)
	assert.InDelta(t, 70.0, weights[k("@x/app", "test:browser")], 0.001)
	assert.NotContains(t, weights, k("@x/gone", "test"))
}

// @scenario "A committed script its package no longer defines is dropped"
func TestWeighDropsAScriptItsPackageNoLongerDefines(t *testing.T) {
	previous := ParseWeights("@x/app  test  30\n@x/app  test:browser  70\n")
	defined := func(key ScriptKey) bool { return key == k("@x/app", "test") }

	weights := Weigh([][]Measurement{{m("@x/app", "test", 40, false)}}, previous, defined)

	assert.NotContains(t, weights, k("@x/app", "test:browser"))
}

// @scenario "A measured script its package no longer defines is dropped"
func TestWeighDropsAMeasuredScriptItsPackageNoLongerDefines(t *testing.T) {
	defined := func(key ScriptKey) bool { return key == k("@x/app", "test") }

	weights := Weigh([][]Measurement{
		{m("@x/app", "test", 40, false), m("@x/app", "test:browser", 70, false), m("@x/gone", "test", 20, true)},
	}, nil, defined)

	assert.Equal(t, map[ScriptKey]float64{k("@x/app", "test"): 40}, weights)
}

// @scenario "A package's weight is the median of its runs, kept per script"
func TestWeighKeepsTheMedianOfEachScriptApart(t *testing.T) {
	weights := Weigh([][]Measurement{
		{m("a", "test", 50, false), m("a", "test:integration", 274, false)},
		{m("a", "test", 40, false), m("a", "test:integration", 404, false)},
		{m("a", "test", 60, false), m("a", "test:integration", 300, false)},
	}, nil, allDefined)

	assert.InDelta(t, 50.0, weights[k("a", "test")], 0.001)
	assert.InDelta(t, 300.0, weights[k("a", "test:integration")], 0.001)
}

// @scenario "The file lists each script with its own seconds"
func TestParseWeightsReadsPackageScriptAndSeconds(t *testing.T) {
	got := ParseWeights("# h\n@x/a  test  161\n@x/a  test:browser  15 # n\nbad line\n@x/b  test\n@x/c  test  0\n")

	assert.Equal(t, map[ScriptKey]float64{k("@x/a", "test"): 161, k("@x/a", "test:browser"): 15}, got)
}

type fakeSource struct {
	runs []int64
	jobs map[int64][]Job
	logs map[int64]string
}

func (f fakeSource) MainRuns() ([]int64, error)    { return f.runs, nil }
func (f fakeSource) Jobs(run int64) ([]Job, error) { return f.jobs[run], nil }
func (f fakeSource) Log(job int64) (string, error) {
	if log, ok := f.logs[job]; ok {
		return log, nil
	}
	return "", errors.New("no such job")
}

func shards(first int64, conclusions ...string) []Job {
	jobs := []Job{{ID: first * 100, Name: "lint", Conclusion: "failure"}}
	for i, conclusion := range conclusions {
		jobs = append(jobs, Job{
			ID:         first*10 + int64(i),
			Name:       "package-suites (" + string(rune('1'+i)) + "/" + string(rune('0'+len(conclusions))) + ")",
			Conclusion: conclusion,
		})
	}
	return jobs
}

func logLine(pkg string, seconds string) string {
	return "##[group]" + pkg + " (dir) — pnpm run test (" + seconds + "s)\n"
}

// @scenario "A run with a failed shard is skipped"
func TestCollectSkipsARunWithAFailedShard(t *testing.T) {
	src := fakeSource{
		runs: []int64{3, 2, 1},
		jobs: map[int64][]Job{
			3: shards(3, "success", "failure"),
			2: shards(2, "success", "success"),
			1: shards(1, "success", "success"),
		},
		logs: map[int64]string{20: logLine("a", "10"), 21: logLine("b", "20"), 10: logLine("a", "30"), 11: logLine("b", "40")},
	}

	ids, measured, err := Collect(src, 2)

	require.NoError(t, err)
	assert.Equal(t, []int64{2, 1}, ids)
	assert.Len(t, measured, 2)
	assert.Equal(t, []Measurement{m("a", "test", 10, false), m("b", "test", 20, false)}, measured[0])
}

// @scenario "Too few green runs is an error rather than a thin file"
func TestCollectRefusesTooFewGreenRuns(t *testing.T) {
	src := fakeSource{
		runs: []int64{2, 1},
		jobs: map[int64][]Job{2: shards(2, "success", "cancelled"), 1: shards(1, "success")},
		logs: map[int64]string{10: logLine("a", "10")},
	}

	_, _, err := Collect(src, 2)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "found 1")
}

// @scenario "Asking for no runs is an error rather than an empty file"
func TestCollectRefusesANonPositiveRunCount(t *testing.T) {
	for _, want := range []int{0, -1} {
		_, _, err := Collect(fakeSource{runs: []int64{1}}, want)

		require.Error(t, err)
	}
}

// @scenario "The browser job is measured when present and must be green"
func TestSuiteJobsTakesAGreenBrowserJobAndRejectsAFailedOne(t *testing.T) {
	jobs := shards(1, "success", "success")

	got, ok := suiteJobs(append(jobs, Job{ID: 99, Name: "package-suites (browser)", Conclusion: "success"}))
	assert.True(t, ok)
	assert.Len(t, got, 3)

	_, ok = suiteJobs(append(jobs, Job{ID: 99, Name: "package-suites (browser)", Conclusion: "failure"}))
	assert.False(t, ok)
}

func TestARunMissingAShardIsNotComplete(t *testing.T) {
	_, ok := suiteJobs([]Job{{ID: 1, Name: "package-suites (1/8)", Conclusion: "success"}})

	assert.False(t, ok)
}

// @scenario "The file is written heaviest first and names its runs"
func TestRenderListsHeaviestScriptFirstAndNamesTheRuns(t *testing.T) {
	out := Render(map[ScriptKey]float64{
		k("@x/b", "test"): 120.4, k("@x/a", "test:browser"): 120.2, k("@x/a", "test"): 120.3,
		k("@x/c", "test"): 300, k("@x/tiny", "test"): 9.4,
	}, []int64{11, 22})

	var body []string
	for _, line := range strings.Split(out, "\n") {
		if line != "" && !strings.HasPrefix(line, "#") {
			body = append(body, line)
		}
	}
	assert.Equal(t, []string{
		"@x/c  test  300", "@x/a  test  120", "@x/a  test:browser  120", "@x/b  test  120",
	}, body)
	assert.Contains(t, out, "main runs 11, 22")
}

// @scenario "GitHub's listings are read strictly"
func TestParseIDsReadsOneRunPerLine(t *testing.T) {
	ids, err := parseIDs("101\n202\n\n")
	require.NoError(t, err)
	assert.Equal(t, []int64{101, 202}, ids)

	_, err = parseIDs("101\nnot-an-id\n")
	assert.Error(t, err)
}

// @scenario "GitHub's listings are read strictly"
func TestParseJobsReadsIDConclusionAndName(t *testing.T) {
	jobs, err := parseJobs("7\tsuccess\tpackage-suites (1/8)\n8\tfailure\tlint\twith a tab\n\n")
	require.NoError(t, err)
	assert.Equal(t, []Job{
		{ID: 7, Conclusion: "success", Name: "package-suites (1/8)"},
		{ID: 8, Conclusion: "failure", Name: "lint\twith a tab"},
	}, jobs)

	_, err = parseJobs("7\tsuccess\n")
	require.Error(t, err, "a short line is an error, not a skipped job")
	_, err = parseJobs("x\tsuccess\tlint\n")
	assert.Error(t, err)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
}

// @scenario "Workspace globs decide which packages define scripts"
func TestDefinedScriptsFollowsWorkspaceGlobs(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "pnpm-workspace.yaml"),
		"packages:\n  - packages/*\n  - modules/*/*\n  - '!packages/skip'\n")
	writeFile(t, filepath.Join(root, "packages", "a", "package.json"), `{"name":"a","scripts":{"test":"x"}}`)
	writeFile(t, filepath.Join(root, "packages", "skip", "package.json"), `{"name":"skip","scripts":{"test":"x"}}`)
	writeFile(t, filepath.Join(root, "modules", "m", "process", "package.json"), `{"name":"m","scripts":{"test:integration":"x"}}`)
	writeFile(t, filepath.Join(root, "other", "package.json"), `{"name":"other","scripts":{"test":"x"}}`)

	defined, err := DefinedScripts(root)

	require.NoError(t, err)
	assert.True(t, defined(k("a", "test")))
	assert.True(t, defined(k("m", "test:integration")))
	assert.False(t, defined(k("skip", "test")), "negated glob excludes the package")
	assert.False(t, defined(k("other", "test")), "unmatched dir is not a package")
	assert.False(t, defined(k("a", "test:unit")))
}

// @scenario "Only the scripts the gate runs are defined"
func TestScriptsForMirrorsTheGate(t *testing.T) {
	all := map[string]string{"test": "a", "test:unit": "b", "test:integration": "c", "test:browser": "d", "build": "e"}

	assert.ElementsMatch(t, []string{"test:unit", "test:integration", "test:browser"}, scriptsFor(all))
	assert.Equal(t, []string{"test"}, scriptsFor(map[string]string{"test": "a", "build": "e"}))
	assert.Empty(t, scriptsFor(map[string]string{"build": "e"}))
}
