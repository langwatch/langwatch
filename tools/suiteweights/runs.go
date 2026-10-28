package suiteweights

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// Job is one job of a workflow run.
type Job struct {
	ID         int64
	Name       string
	Conclusion string
}

// Source is where the runs and their logs come from: GitHub through `gh`, or
// a fake in the tests.
type Source interface {
	// MainRuns lists completed runs of the app CI on main, newest first.
	MainRuns() ([]int64, error)
	Jobs(run int64) ([]Job, error)
	Log(job int64) (string, error)
}

var shardName = regexp.MustCompile(`^package-suites \((\d+)/(\d+)\)$`)

// suiteJobs returns the run's package-suites jobs when every shard ran and
// passed. A failed or cancelled shard stops early or reruns nothing, so its
// times are not what the suites cost, and a run missing a shard did not
// measure every package.
func suiteJobs(jobs []Job) ([]Job, bool) {
	var found []Job
	total := 0
	for _, job := range jobs {
		match := shardName.FindStringSubmatch(job.Name)
		if match == nil {
			continue
		}
		total, _ = strconv.Atoi(match[2])
		if job.Conclusion != "success" {
			return nil, false
		}
		found = append(found, job)
	}
	return found, total > 0 && len(found) == total
}

// Collect measures the newest `want` runs on main whose package-suites shards
// all passed, and returns their ids with every measurement of each.
func Collect(src Source, want int) ([]int64, [][]Measurement, error) {
	runs, err := src.MainRuns()
	if err != nil {
		return nil, nil, err
	}
	var ids []int64
	var measured [][]Measurement
	for _, run := range runs {
		if len(ids) == want {
			break
		}
		got, ok, err := measureRun(src, run)
		if err != nil {
			return nil, nil, err
		}
		if ok {
			ids = append(ids, run)
			measured = append(measured, got)
		}
	}
	if len(ids) < want {
		return nil, nil, fmt.Errorf("found %d main runs with every package-suites shard green, wanted %d", len(ids), want)
	}
	return ids, measured, nil
}

func measureRun(src Source, run int64) ([]Measurement, bool, error) {
	jobs, err := src.Jobs(run)
	if err != nil {
		return nil, false, err
	}
	shards, ok := suiteJobs(jobs)
	if !ok {
		return nil, false, nil
	}
	var all []Measurement
	for _, job := range shards {
		log, err := src.Log(job.ID)
		if err != nil {
			return nil, false, err
		}
		all = append(all, ParseJobLog(log)...)
	}
	return all, true, nil
}

// GitHub reads runs of the app CI workflow through the `gh` CLI.
type GitHub struct {
	Ctx      context.Context
	Repo     string
	Workflow string
}

func (g GitHub) gh(args ...string) (string, error) {
	cmd := exec.CommandContext(g.Ctx, "gh", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("gh %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return string(out), nil
}

// MainRuns lists the newest completed push runs on main.
func (g GitHub) MainRuns() ([]int64, error) {
	out, err := g.gh("api", fmt.Sprintf(
		"repos/%s/actions/workflows/%s/runs?branch=main&event=push&status=completed&per_page=100", g.Repo, g.Workflow),
		"--jq", ".workflow_runs[].id")
	if err != nil {
		return nil, err
	}
	return parseIDs(out)
}

// Jobs lists every job of a run.
func (g GitHub) Jobs(run int64) ([]Job, error) {
	out, err := g.gh("api", "--paginate", fmt.Sprintf("repos/%s/actions/runs/%d/jobs?per_page=100", g.Repo, run),
		"--jq", `.jobs[] | "\(.id)\t\(.conclusion)\t\(.name)"`)
	if err != nil {
		return nil, err
	}
	var jobs []Job
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		fields := strings.SplitN(line, "\t", 3)
		if len(fields) != 3 {
			continue
		}
		id, err := strconv.ParseInt(fields[0], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("job id %q: %w", fields[0], err)
		}
		jobs = append(jobs, Job{ID: id, Conclusion: fields[1], Name: fields[2]})
	}
	return jobs, nil
}

// Log downloads one job's log.
func (g GitHub) Log(job int64) (string, error) {
	return g.gh("api", "--allow-escape-sequences", fmt.Sprintf("repos/%s/actions/jobs/%d/logs", g.Repo, job))
}

func parseIDs(out string) ([]int64, error) {
	var ids []int64
	for _, field := range strings.Fields(out) {
		id, err := strconv.ParseInt(field, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("run id %q: %w", field, err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}
