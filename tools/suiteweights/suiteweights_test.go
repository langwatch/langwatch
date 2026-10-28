package suiteweights

import (
	"errors"
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

// @scenario "A suite Nx replayed from its cache does not make it look cheap"
func TestWeighIgnoresCacheReplaysWhenARealRunExists(t *testing.T) {
	weights := Weigh([][]Measurement{
		{m("a", "test", 2, true)},
		{m("a", "test", 90, false)},
		{m("a", "test", 3, true)},
	}, nil)

	assert.InDelta(t, 90.0, weights["a"], 0.001)
}

// @scenario "A suite only ever replayed from the cache still has a weight"
func TestWeighFallsBackToReplaysWhenNothingRanForReal(t *testing.T) {
	weights := Weigh([][]Measurement{{m("a", "test", 4, true)}, {m("a", "test", 6, true)}}, nil)

	assert.InDelta(t, 5.0, weights["a"], 0.001)
}

// @scenario "A package only ever replayed from the cache keeps its committed weight"
func TestWeighKeepsTheCommittedWeightOfAPackageNoRunExecuted(t *testing.T) {
	previous := ParseWeights("# header\n@x/sims  28\n@x/ran  90  # note\n")

	weights := Weigh([][]Measurement{
		{m("@x/sims", "test", 2, true), m("@x/ran", "test", 40, false)},
		{m("@x/sims", "test", 3, true), m("@x/ran", "test", 50, false)},
	}, previous)

	assert.InDelta(t, 28.0, weights["@x/sims"], 0.001)
	assert.InDelta(t, 45.0, weights["@x/ran"], 0.001)
}

// @scenario "A package's weight is the median of its runs, summed over its scripts"
func TestWeighSumsTheMedianOfEachScript(t *testing.T) {
	weights := Weigh([][]Measurement{
		{m("a", "test", 50, false), m("a", "test:integration", 274, false)},
		{m("a", "test", 40, false), m("a", "test:integration", 404, false)},
		{m("a", "test", 60, false), m("a", "test:integration", 300, false)},
	}, nil)

	assert.InDelta(t, 350.0, weights["a"], 0.001)
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

func TestARunMissingAShardIsNotComplete(t *testing.T) {
	_, ok := suiteJobs([]Job{{ID: 1, Name: "package-suites (1/8)", Conclusion: "success"}})

	assert.False(t, ok)
}

// @scenario "The file is written heaviest first and names its runs"
func TestRenderListsHeaviestFirstAndNamesTheRuns(t *testing.T) {
	out := Render(map[string]float64{"@x/b": 120.4, "@x/a": 120.2, "@x/c": 300, "@x/tiny": 9.4}, []int64{11, 22})

	var body []string
	for _, line := range strings.Split(out, "\n") {
		if line != "" && !strings.HasPrefix(line, "#") {
			body = append(body, line)
		}
	}
	assert.Equal(t, []string{"@x/c  300", "@x/a  120", "@x/b  120"}, body)
	assert.Contains(t, out, "main runs 11, 22")
}
