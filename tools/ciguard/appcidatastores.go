package ciguard

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// Spec: specs/ci/app-ci-datastores.feature

// AppCIWorkflows are the workflows that run the app's suites against datastores.
var AppCIWorkflows = []string{
	".github/workflows/langwatch-app-ci.yml",
	".github/workflows/e2e-ci.yml",
}

// waitContainersCommand holds a step until the containers it names are healthy.
const waitContainersCommand = "go run ./cmd/waitcontainers"

// runsWaitContainers matches the command where a shell line or a chained command starts,
// whatever its spacing, and not where it is only mentioned inside an argument.
var runsWaitContainers = regexp.MustCompile(`(?m)(^|&&|\|\||;)\s*go\s+run\s+(\./)?cmd/waitcontainers\b`)

// afterFailure matches an `if:` that runs a step after an earlier step failed or once the job
// is cancelled. `!cancelled()` alone is the main line of the checks job, so it is not matched.
var afterFailure = regexp.MustCompile(`\b(always|failure)\(\)|(^|[^!\w])cancelled\(\)`)

// detachedContainer matches a `docker run -d ... --name X` command, its continuation lines joined.
var detachedContainer = regexp.MustCompile(`\bdocker\s+run\b[^\n]*?\s(?:-d|--detach)\b[^\n]*?\s--name[\s=]+([\w.-]+)`)

// readsDatastores matches a step that migrates or runs suites against the job's datastores.
var readsDatastores = regexp.MustCompile(
	`\bpnpm\b[^\n]*\b(task\s+upgrade|start:prepare:db|test(:[\w-]+)?)\b|run-package-suites`)

// AppCIDatastores reports a `services:` block in the app CI workflows (the runner pulls and
// health-waits its containers before the first step, and stops them after the last with no
// timeout a workflow can set), and a step running after a failure, or waiting for containers,
// without its own timeout-minutes.
func AppCIDatastores(root string) ([]string, error) {
	var problems []string
	for _, path := range AppCIWorkflows {
		workflow, err := ciscan.Load(root, path)
		if err != nil {
			return nil, err
		}
		for _, name := range workflow.JobNames() {
			problems = append(problems, appCIJobProblems(path, name, workflow.Jobs[name])...)
		}
	}

	return problems, nil
}

// appCIJobProblems checks one job of an app CI workflow.
func appCIJobProblems(path, name string, job ciscan.Job) []string {
	where := fmt.Sprintf("%s job %q", path, name)
	var problems []string
	if len(job.Services) > 0 {
		names := make([]string, 0, len(job.Services))
		for service := range job.Services {
			names = append(names, service)
		}
		slices.Sort(names)
		problems = append(problems, fmt.Sprintf(
			"%s declares services: %s; start them with docker run in the background and wait with %s",
			where, strings.Join(names, ", "), waitContainersCommand))
	}
	for i := range job.Steps {
		if unboundedStep(&job.Steps[i]) {
			problems = append(problems, fmt.Sprintf("%s: step %q needs its own timeout-minutes", where, stepLabel(&job.Steps[i], i)))
		}
	}

	return append(problems, unwaitedContainers(where, job.Steps)...)
}

// unwaitedContainers reports a container started detached that no later cmd/waitcontainers step
// names, and a step that migrates or runs suites before any wait after the containers started.
func unwaitedContainers(where string, steps []ciscan.Step) []string {
	scan := containerScan{where: where, steps: steps, waited: map[string]bool{}, startedAt: -1}
	for i := range steps {
		scan.step(i)
	}

	return append(scan.problems, scan.unwaited()...)
}

// containerScan walks one job's steps in order, tracking the containers started and waited for.
type containerScan struct {
	where     string
	steps     []ciscan.Step
	waited    map[string]bool
	started   []string
	startedAt int // the first step that started a container no wait has followed yet, or -1
	problems  []string
}

// step reads one step: a wait, a read of the datastores, or a start of containers.
func (s *containerScan) step(i int) {
	run := strings.ReplaceAll(s.steps[i].Run, "\\\n", " ")
	if names := waitedNames(run); names != nil {
		for _, name := range names {
			s.waited[name] = true
		}
		s.startedAt = -1
	} else if s.startedAt >= 0 && readsDatastores.MatchString(run) {
		s.problems = append(s.problems, fmt.Sprintf("%s: step %q reads the datastores started by step %q before a %s step",
			s.where, stepLabel(&s.steps[i], i), stepLabel(&s.steps[s.startedAt], s.startedAt), waitContainersCommand))
		s.startedAt = -1
	}
	for _, match := range detachedContainer.FindAllStringSubmatch(run, -1) {
		s.started = append(s.started, match[1])
		delete(s.waited, match[1])
		if s.startedAt < 0 {
			s.startedAt = i
		}
	}
}

// unwaited reports every started container that no later wait named.
func (s *containerScan) unwaited() []string {
	var problems []string
	for _, name := range s.started {
		if !s.waited[name] {
			problems = append(problems, fmt.Sprintf("%s: container %q starts in the background but no later %s step names it",
				s.where, name, waitContainersCommand))
		}
	}

	return problems
}

// waitedNames returns the containers a cmd/waitcontainers command names, or nil when the
// run has none. Every flag of the command takes a value.
func waitedNames(run string) []string {
	loc := runsWaitContainers.FindStringIndex(run)
	if loc == nil {
		return nil
	}
	line, _, _ := strings.Cut(run[loc[1]:], "\n")
	names := []string{}
	fields := strings.Fields(line)
	for i := 0; i < len(fields); i++ {
		switch field := fields[i]; {
		case field == "&&" || field == "||" || field == ";":
			return names
		case strings.HasPrefix(field, "-"):
			if !strings.Contains(field, "=") {
				i++
			}
		default:
			names = append(names, field)
		}
	}

	return names
}

// unboundedStep reports a step that runs after a failure, or waits for containers, with no
// timeout-minutes of its own, so a hang there holds the job until the job's own timeout.
func unboundedStep(step *ciscan.Step) bool {
	needsBound := afterFailure.MatchString(step.If) || runsWaitContainers.MatchString(step.Run)

	return needsBound && step.TimeoutMinutes == nil
}

// stepLabel names a step in a finding: its name, else its action, else its first run line,
// else its position in the job.
func stepLabel(step *ciscan.Step, index int) string {
	switch first, _, _ := strings.Cut(strings.TrimSpace(step.Run), "\n"); {
	case step.Name != "":
		return step.Name
	case step.Uses != "":
		return step.Uses
	case first != "":
		return first
	default:
		return fmt.Sprintf("#%d", index+1)
	}
}
