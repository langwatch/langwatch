package migrationorder_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

type workflowStep struct {
	Name string            `yaml:"name"`
	ID   string            `yaml:"id"`
	If   string            `yaml:"if"`
	Uses string            `yaml:"uses"`
	Run  string            `yaml:"run"`
	With map[string]any    `yaml:"with"`
	Env  map[string]string `yaml:"env"`
}

type workflowFile struct {
	On   map[string]yaml.Node `yaml:"on"`
	Jobs map[string]struct {
		If    string         `yaml:"if"`
		Steps []workflowStep `yaml:"steps"`
	} `yaml:"jobs"`
}

func loadWorkflow(t *testing.T, name string) (workflowFile, string) {
	t.Helper()
	root, err := ciscan.RepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, ".github", "workflows", name))
	if err != nil {
		t.Fatal(err)
	}
	var workflow workflowFile
	if err := yaml.Unmarshal(raw, &workflow); err != nil {
		t.Fatal(err)
	}
	return workflow, string(raw)
}

func triggerPaths(t *testing.T, workflow workflowFile) []string {
	t.Helper()
	node, ok := workflow.On["pull_request"]
	if !ok {
		t.Fatal("no pull_request trigger")
	}
	var trigger struct {
		Paths []string `yaml:"paths"`
	}
	if err := node.Decode(&trigger); err != nil {
		t.Fatal(err)
	}
	return trigger.Paths
}

func stepNamed(t *testing.T, steps []workflowStep, name string) workflowStep {
	t.Helper()
	index := slices.IndexFunc(steps, func(s workflowStep) bool { return s.Name == name })
	if index < 0 {
		t.Fatalf("no step named %q", name)
	}
	return steps[index]
}

// @scenario "The workflow runs only on PRs that touch a migration"
func TestCompatWorkflowTriggersOnlyOnMigrationPaths(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	want := []string{
		"packages/prisma-client/prisma/migrations/**",
		"packages/prisma-client/prisma/schema.prisma",
		"packages/clickhouse-migrations/migrations/**",
		"modules/*/process/src/**/migrations/**",
		"enterprise/modules/*/process/src/**/migrations/**",
		".github/workflows/migration-compat.yml",
		"dev/scripts/migration-compat-smoke/**",
	}
	if got := triggerPaths(t, workflow); !slices.Equal(got, want) {
		t.Errorf("trigger paths = %q, want %q", got, want)
	}
	for _, forbidden := range []string{"pull_request_target", "push"} {
		if _, ok := workflow.On[forbidden]; ok {
			t.Errorf("migration-compat must not trigger on %s", forbidden)
		}
	}
	for job, want := range map[string]string{
		"n-minus-one":  "github.event_name == 'pull_request'",
		"prisma-drift": "github.event_name == 'pull_request'",
		"lts-floor":    "github.event_name != 'pull_request'",
	} {
		if got := workflow.Jobs[job].If; got != want {
			t.Errorf("job %s if = %q, want %q", job, got, want)
		}
	}
}

// @scenario "Base code passes its live api suites on the schema head migrated"
func TestCompatWorkflowRunsBaseSuitesOnHeadsSchema(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	steps := workflow.Jobs["n-minus-one"].Steps
	names := make([]string, len(steps))
	for i, s := range steps {
		names[i] = s.Name
	}
	migrate := slices.Index(names, "Migrate with head's tasks")
	suites := slices.Index(names, "Base's live api suites on head's schema")
	if migrate < 0 || suites < 0 || migrate > suites {
		t.Fatalf("head must migrate before base's suites run: %q", names)
	}
	head := stepNamed(t, steps, "Migrate with head's tasks")
	if !strings.HasSuffix(head.Env["CLICKHOUSE_URL"], "/test_analytics_migrated_schema") ||
		!strings.Contains(head.Run, "pnpm --filter @langwatch/tasks task upgrade") {
		t.Errorf("head's upgrade must migrate Postgres and the fixture's ClickHouse database: %+v", head)
	}
	base := stepNamed(t, steps, "Checkout base (the merge commit's first parent)")
	if base.With["ref"] != "${{ steps.base.outputs.sha }}" || base.With["path"] != "base" {
		t.Errorf("base checkout = %+v", base.With)
	}
	layout := stepNamed(t, steps, "Can the base be judged")
	for _, suite := range []string{"api-executable", "api-trpc-record"} {
		if !strings.Contains(layout.Run, suite) {
			t.Errorf("the judged suites leave out %s", suite)
		}
	}
}

// @scenario "A base suite that silently skips fails the job"
func TestCompatWorkflowFailsASuiteThatPassedNothing(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	step := stepNamed(t, workflow.Jobs["n-minus-one"].Steps, "Every base suite passed a test")
	if !strings.Contains(step.Run, `select(.status == "passed")] | length == 0`) || !strings.Contains(step.Run, "exit 1") {
		t.Errorf("the suite check does not fail a file with no passed test:\n%s", step.Run)
	}
}

// @scenario "Native ClickHouse mode is forced for the base suites"
func TestCompatWorkflowUnsetsCIForTheBaseSuites(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	step := stepNamed(t, workflow.Jobs["n-minus-one"].Steps, "Base's live api suites on head's schema")
	if !strings.Contains(step.Run, "env -u CI pnpm test") {
		t.Errorf("the base suites run with CI set:\n%s", step.Run)
	}
	for _, key := range []string{"LANGWATCH_TEST_DATABASE_URL", "LANGWATCH_TEST_REDIS_URL", "LANGWATCH_TEST_CLICKHOUSE_URL"} {
		if step.Env[key] == "" {
			t.Errorf("the base suites are not given %s", key)
		}
	}
}

// @scenario "A base without the live api suite is judged by its image instead"
func TestCompatWorkflowJudgesAnUnjudgeableBaseByItsImage(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	steps := workflow.Jobs["n-minus-one"].Steps
	layout := stepNamed(t, steps, "Can the base be judged")
	if !strings.Contains(layout.Run, "::warning") || !strings.Contains(layout.Run, "judged=false") {
		t.Errorf("an unjudgeable base is not reported as a warning:\n%s", layout.Run)
	}
	for _, name := range []string{"Install and prepare base", "Base's live api suites on head's schema", "Every base suite passed a test"} {
		if got := stepNamed(t, steps, name).If; got != "steps.layout.outputs.judged == 'true'" {
			t.Errorf("step %q runs on an unjudgeable base (if = %q)", name, got)
		}
	}
	for name, want := range map[string]string{
		"Read the LTS floor": "packages/upgrade/releases/lts-floor.json",
		"The LTS floor image passes the smoke on head's schema": "run-old-image.sh floor",
		"Resolve main head's image":                             "main-head-image.sh base",
		"Main head's image passes the smoke on head's schema":   "run-old-image.sh main-head",
	} {
		step := stepNamed(t, steps, name)
		if step.If != "steps.layout.outputs.judged == 'false'" {
			t.Errorf("step %q does not run on an unjudgeable base (if = %q)", name, step.If)
		}
		if !strings.Contains(step.Run, want) {
			t.Errorf("step %q lacks %q:\n%s", name, want, step.Run)
		}
	}
}

func smokeScript(t *testing.T, name string) string {
	t.Helper()
	root, err := ciscan.RepoRoot(".")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "dev", "scripts", "migration-compat-smoke", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// @scenario "The image of main's head is pulled when published, else built"
func TestCompatSmokePullsOrBuildsMainHeadsImage(t *testing.T) {
	script := smokeScript(t, "main-head-image.sh")
	for _, want := range []string{`git -C "$base_dir" rev-parse HEAD`, "docker manifest inspect", "docker pull",
		`docker build -q -f "${base_dir}/infra/docker/Dockerfile"`} {
		if !strings.Contains(script, want) {
			t.Errorf("main-head-image.sh lacks %q", want)
		}
	}
	if strings.Index(script, "docker pull") > strings.Index(script, "docker build") {
		t.Error("main-head-image.sh builds before it tries the published image")
	}
}

// @scenario "An old image's log naming a missing table or column fails the job"
func TestCompatSmokeScansTheOldImagesLog(t *testing.T) {
	script := smokeScript(t, "run-old-image.sh")
	for _, want := range []string{`(column|relation) "[^"]+" does not exist|P2021|P2022|Code: (47|60)\.`,
		`node "${here}/smoke.mjs"`, "::error title=migration-compat::"} {
		if !strings.Contains(script, want) {
			t.Errorf("run-old-image.sh lacks %q", want)
		}
	}
}

// @scenario "The Prisma drift job refuses drift the PR adds"
// @scenario "Drift the base already carries does not fail the PR"
func TestCompatWorkflowJudgesOnlyTheDriftThePRAdds(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	step := stepNamed(t, workflow.Jobs["prisma-drift"].Steps, "Drift the PR adds")
	for _, want := range []string{"--from-migrations", "--to-schema", "--exit-code", "--script", "shadowDatabaseUrl",
		`drift "${GITHUB_WORKSPACE}/head"`, `drift "${GITHUB_WORKSPACE}/base"`, "comm -13"} {
		if !strings.Contains(step.Run, want) {
			t.Errorf("the drift step lacks %q", want)
		}
	}
}

// @scenario "A Prisma diff that errors fails the drift job"
func TestCompatWorkflowFailsADiffThatErrors(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	step := stepNamed(t, workflow.Jobs["prisma-drift"].Steps, "Drift the PR adds")
	if !strings.Contains(step.Run, `[ "$status" -ne 0 ] && [ "$status" -ne 2 ]`) {
		t.Errorf("exit statuses other than 0 and 2 are not read as failure:\n%s", step.Run)
	}
}

// @scenario "The LTS floor's image boots on the schema head migrated"
func TestCompatWorkflowBootsTheFloorImageNightly(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-compat.yml")
	if _, ok := workflow.On["schedule"]; !ok {
		t.Error("no nightly schedule")
	}
	if _, ok := workflow.On["workflow_dispatch"]; !ok {
		t.Error("no manual dispatch")
	}
	steps := workflow.Jobs["lts-floor"].Steps
	if read := stepNamed(t, steps, "Read the LTS floor"); !strings.Contains(read.Run, "packages/upgrade/releases/lts-floor.json") {
		t.Errorf("the floor is not read from lts-floor.json:\n%s", read.Run)
	}
	smoke := stepNamed(t, steps, "The floor image answers and names nothing missing")
	for _, want := range []string{"/api/health", "does not exist", "P2022"} {
		if !strings.Contains(smoke.Run, want) {
			t.Errorf("the floor smoke lacks %q", want)
		}
	}
}

// @scenario "The comment goes away once the migration is renumbered"
// @scenario "An unchanged finding is not re-posted on every push"
// @scenario "A fork PR still fails, without a comment"
func TestOrderWorkflowCommentLifecycle(t *testing.T) {
	workflow, _ := loadWorkflow(t, "migration-order.yml")
	steps := workflow.Jobs["migration-order"].Steps
	comment := stepNamed(t, steps, "Comment with the fix")
	script, _ := comment.With["script"].(string)
	if !strings.Contains(script, "deleteComment") {
		t.Error("a fixed PR keeps its comment")
	}
	if !strings.Contains(script, "existing.body !== body") {
		t.Error("an unchanged comment is re-posted")
	}
	if comment.If != "github.event.pull_request.head.repo.full_name == github.repository" {
		t.Errorf("the comment step is attempted on forks: if = %q", comment.If)
	}
	if fail := stepNamed(t, steps, "Fail if out of order"); fail.If != "" {
		t.Errorf("the failing step is skipped somewhere: if = %q", fail.If)
	}
}

var expression = regexp.MustCompile(`\$\{\{[^}]*\}\}`)

func TestWorkflowShellParses(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash is not installed")
	}
	for _, name := range []string{"migration-compat.yml", "migration-order.yml"} {
		workflow, _ := loadWorkflow(t, name)
		for job, definition := range workflow.Jobs {
			for _, step := range definition.Steps {
				if step.Run == "" {
					continue
				}
				script := expression.ReplaceAllString(step.Run, "placeholder")
				cmd := exec.CommandContext(t.Context(), bash, "-n")
				cmd.Stdin = strings.NewReader(script)
				if out, err := cmd.CombinedOutput(); err != nil {
					t.Errorf("%s job %s step %q does not parse: %v\n%s", name, job, step.Name, err, out)
				}
			}
		}
	}
}
