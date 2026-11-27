package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// Spec: specs/ci/docs-playwright-chromium.feature

const (
	playwrightAction      = ".github/actions/playwright-chromium/action.yml"
	playwrightActionUse   = "./.github/actions/playwright-chromium"
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
// that every step using it carries a timeout its job can enforce.
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
	raw, err := os.ReadFile(filepath.Join(root, playwrightAction))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", playwrightAction, err)
	}
	var action struct {
		Runs struct {
			Steps []ciscan.Step `yaml:"steps"`
		} `yaml:"runs"`
	}
	if err := yaml.Unmarshal(raw, &action); err != nil {
		return nil, fmt.Errorf("parse %s: %w", playwrightAction, err)
	}
	i := slices.IndexFunc(action.Runs.Steps, func(s ciscan.Step) bool { return s.ID == playwrightInstallStep })
	if i == -1 {
		return nil, nil
	}
	return &action.Runs.Steps[i], nil
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

// playwrightUseProblems reports steps using the action whose timeout cannot hold both attempts or cannot fire.
func playwrightUseProblems(w *ciscan.Workflow, budget playwrightBudget) []string {
	var problems []string
	for _, name := range w.JobNames() {
		job := w.Jobs[name]
		for i := range job.Steps {
			if job.Steps[i].Uses != playwrightActionUse {
				continue
			}
			use := playwrightUse{
				where:       fmt.Sprintf("%s job %q", w.Path, name),
				stepTimeout: job.Steps[i].TimeoutMinutes,
				jobTimeout:  job.TimeoutMinutes,
			}
			problems = append(problems, use.timeoutProblems(budget)...)
		}
	}
	return problems
}

// playwrightUse is one workflow step using the action, with its own and its job's timeout.
type playwrightUse struct {
	where       string
	stepTimeout any
	jobTimeout  any
}

func (u playwrightUse) timeoutProblems(budget playwrightBudget) []string {
	where := u.where
	stepMinutes, ok := minutes(u.stepTimeout)
	if !ok {
		return []string{where + ": the playwright-chromium step sets no numeric timeout-minutes"}
	}
	var problems []string
	if stepMinutes*60 < budget.seconds {
		problems = append(problems, fmt.Sprintf("%s: the playwright-chromium step's %d minutes cannot cover both attempts and the pause (%ds)", where, stepMinutes, budget.seconds))
	}
	if jobMinutes, ok := minutes(u.jobTimeout); ok && jobMinutes <= stepMinutes {
		problems = append(problems, fmt.Sprintf("%s: the job's %d minutes is not above the playwright-chromium step's %d, so the step bound never fires", where, jobMinutes, stepMinutes))
	}
	return problems
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
