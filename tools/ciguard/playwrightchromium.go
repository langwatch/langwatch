package ciguard

import (
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// Spec: specs/ci/docs-playwright-chromium.feature

const (
	playwrightAction      = ".github/actions/playwright-chromium/action.yml"
	playwrightActionUse   = ".github/actions/playwright-chromium"
	playwrightInstallStep = "playwright-install"
	// playwrightMinInstallSeconds matches the ffmpeg install bound in docs-media-encoders.
	playwrightMinInstallSeconds = 600
)

var (
	playwrightAptUpdate = regexp.MustCompile(`timeout (\d+) apt-get [^\n]*\bupdate\b`)
	// The refresh's own failure is handled on its line, so errexit never stops the attempt there.
	playwrightAptTolerated = regexp.MustCompile(`apt-get [^\n]*\bupdate\b[ \t]*(\\\n[ \t]*)?\|\|`)
	playwrightInstall      = regexp.MustCompile(`timeout (\d+) pnpm [^\n]*playwright install --with-deps chromium`)
	playwrightRetry        = regexp.MustCompile(`install \|\| \{[^}]*sleep (\d+); install; \}`)
)

// playwrightBudget is the worst case of one install step, in seconds: two attempts and the pause.
type playwrightBudget struct{ seconds int }

// PlaywrightChromiumProblems checks that the playwright-chromium action refreshes the
// apt index and installs under timeouts, survives a failed refresh, retries once, and
// that every job using it has a budget that covers both attempts and the pause.
func PlaywrightChromiumProblems(root string) ([]string, error) {
	install, err := loadPlaywrightInstall(root)
	if err != nil {
		return nil, err
	}
	if install == nil {
		return []string{playwrightAction + ": missing the " + playwrightInstallStep + " step"}, nil
	}
	budget, problems := playwrightInstallProblems(install.Run)
	if len(problems) > 0 {
		return problems, nil
	}
	workflows, err := ciscan.LoadAll(root)
	if err != nil {
		return nil, err
	}
	for _, w := range workflows {
		problems = append(problems, playwrightUseProblems(w, budget)...)
	}
	return problems, nil
}

func loadPlaywrightInstall(root string) (*ciscan.Step, error) {
	steps, err := loadActionSteps(filepath.Join(root, playwrightAction))
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(steps, func(s ciscan.Step) bool { return s.ID == playwrightInstallStep })
	if i == -1 {
		return nil, nil
	}
	return &steps[i], nil
}

// playwrightInstallProblems reads the install script's timeouts and retry, and reports what is missing.
func playwrightInstallProblems(run string) (playwrightBudget, []string) {
	var problems []string
	apt := playwrightAptUpdate.FindStringSubmatch(run)
	if apt == nil {
		problems = append(problems, "playwright install does not refresh the apt index under a timeout (timeout N apt-get ... update)")
	}
	if !playwrightAptTolerated.MatchString(run) {
		problems = append(problems, "a failed apt-get update is not handled on its line, so errexit stops the retry before the install")
	}
	inst := playwrightInstall.FindStringSubmatch(run)
	if inst == nil {
		problems = append(problems, "playwright install --with-deps chromium does not run under a timeout")
	}
	retry := playwrightRetry.FindStringSubmatch(run)
	if retry == nil {
		problems = append(problems, "a failed playwright install is not retried once after a pause (install || { ...; sleep N; install; })")
	}
	if len(inst) > 1 && atoi(inst[1]) < playwrightMinInstallSeconds {
		problems = append(problems, fmt.Sprintf("playwright install's %ss bound is below the %ds a slow mirror needs", inst[1], playwrightMinInstallSeconds))
	}
	if len(problems) > 0 {
		return playwrightBudget{}, problems
	}
	return playwrightBudget{seconds: 2*(atoi(apt[1])+atoi(inst[1])) + atoi(retry[1])}, nil
}

// playwrightUseProblems reports jobs using the action whose timeout cannot hold both attempts and the pause.
func playwrightUseProblems(w *ciscan.Workflow, budget playwrightBudget) []string {
	var problems []string
	for _, name := range w.JobNames() {
		job := w.Jobs[name]
		for i := range job.Steps {
			if !strings.HasSuffix(job.Steps[i].Uses, playwrightActionUse) {
				continue
			}
			where := fmt.Sprintf("%s job %q", w.Path, name)
			problems = append(problems, playwrightJobProblems(where, job.TimeoutMinutes, budget)...)
		}
	}
	return problems
}

// playwrightJobProblems reports a job whose own timeout cannot hold the action's worst case.
func playwrightJobProblems(where string, jobTimeout any, budget playwrightBudget) []string {
	jobMinutes, ok := minutes(jobTimeout)
	if !ok {
		return []string{where + ": the job using playwright-chromium sets no numeric timeout-minutes"}
	}
	if jobMinutes*60 <= budget.seconds {
		return []string{fmt.Sprintf("%s: the job's %d minutes cannot cover both install attempts and the pause (%ds)", where, jobMinutes, budget.seconds)}
	}
	return nil
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
