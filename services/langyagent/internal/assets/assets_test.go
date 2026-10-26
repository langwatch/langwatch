package assets

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The prompt used to name the worker's own endpoint, as an example of an
// address the user must never be given. The manager substitutes that
// placeholder per worker at spawn, so the sentence warning against worker-side
// hosts arrived carrying one, and the agent read a real internal address in the
// one paragraph telling it not to repeat internal addresses. The rule survives;
// the example does not.
//
// @scenario "The system prompt names no address the user cannot reach"
func TestAgentsTemplate_NamesNoWorkerSideAddress(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	if len(tmpl) == 0 {
		t.Fatal("AgentsTemplate is empty")
	}
	for _, banned := range []string{
		"${LANGWATCH_ENDPOINT}",
		"LANGWATCH_ENDPOINT",
		"localhost",
		"127.0.0.1",
	} {
		if strings.Contains(tmpl, banned) {
			t.Errorf("AGENTS.md names %q; the prompt reaches the user through the reply, so it must not carry an address or variable only the worker can use", banned)
		}
	}
}

// Counting is a normal thing to want, and the prompt told the agent to "get the
// total first with the cheapest count query" without ever saying what that was.
// So the agent guessed, twice: a filter the output did not answer and a flag
// the command did not take, then a Python one-liner whose traceback reached the
// user. The rule now names the flags.
//
// @scenario "The prompt says how to count"
func TestAgentsTemplate_SaysHowToCount(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	for _, named := range []string{"--jq length", ".pagination.total"} {
		if !strings.Contains(tmpl, named) {
			t.Errorf("AGENTS.md tells the agent to get a total but never names %q, which is what leaves it guessing at a count", named)
		}
	}
}

// TestAgentsTemplate_EmptyWindowStatesDataAge pins the empty-window rule: state the newest row's age or that it never arrived.
//
// @scenario "The prompt no longer answers an empty window with a bare line"
// @scenario "A filtered question with no matches gets a plain none"
// @scenario "The prompt lets Langy name a skill's telemetry env vars"
func TestAgentsTemplate_EmptyWindowStatesDataAge(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	if strings.Contains(tmpl, `"No X in last 24h."`) {
		t.Errorf(`AGENTS.md still tells the agent to answer an empty time-bounded result with the bare "No X in last 24h."`)
	}
	rule := ""
	for _, line := range strings.Split(tmpl, "\n") {
		if strings.HasPrefix(line, "- A list question") {
			rule = strings.ToLower(line)
		}
	}
	if rule == "" {
		t.Fatalf("AGENTS.md has no line starting with %q", "- A list question")
	}
	for _, phrase := range []string{"newest", "never received", "errors", "say none", "likely cause", "never say you cannot see"} {
		if !strings.Contains(rule, phrase) {
			t.Errorf("AGENTS.md list-question rule never says %q, so an empty window cannot be told from a broken pipeline or zero errors from a fault", phrase)
		}
	}
	if !strings.Contains(tmpl, "a skill's telemetry env var names (key as `<key>`)") {
		t.Errorf("AGENTS.md no longer lets the agent name a skill's telemetry env vars with the key as a placeholder, so the Claude Code telemetry setup gets dropped")
	}
}

// Langy's CLI runs in its own sandbox, so a credential failure is Langy's to
// report, never the user's to fix by signing in; `unauthorized` (HTTP 401) is
// that credential being refused. A permission refusal (`forbidden`,
// `permission_denied`, HTTP 403) is the user's missing access.
//
// @scenario "The prompt reports a sandbox credential failure as an internal error"
func TestAgentsTemplate_ReportsSandboxCredentialFailureAsInternalError(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	for _, phrase := range []string{
		"`missing_api_key`, `unauthorized`, `not_authenticated` or \"Not logged in\" is your sandbox credential",
		"never tell them to sign in",
		"never claim you lack the CLI or tools",
		"say you hit an internal error, name the read or write that failed",
		"`forbidden` or `permission_denied` is a permission refusal: name the access they lack",
	} {
		if !strings.Contains(tmpl, phrase) {
			t.Errorf("AGENTS.md failure rule never says %q", phrase)
		}
	}
	if strings.Contains(tmpl, "`unauthorized` is a permission refusal") {
		t.Errorf("AGENTS.md calls unauthorized (HTTP 401, an expired or revoked sandbox key) a permission refusal, so Langy blames its own credential on the user")
	}
}

// The prompt has a byte budget so it cannot silently grow back into a rule
// pile. It once reached 52,795 bytes by accreting one rule per observed
// failure. A fix that needs the ceiling raised is a fix at the wrong layer:
// state the class in one principle, or move the constraint into the harness
// config. See https://scenario.langwatch.ai/best-practices/improving-your-agent
//
// @scenario "The prompt fits its size budget"
func TestAgentsTemplate_FitsSizeBudget(t *testing.T) {
	const maxPromptBytes = 16 * 1024

	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	// Reported on every run, not only on failure: a passing "under 16KB" says
	// nothing about which prompt is embedded, so it cannot confirm a rebuild
	// picked up an edit. The number can.
	t.Logf("AGENTS.md is %d bytes of the %d-byte budget", len(tmpl), maxPromptBytes)

	if got := len(tmpl); got > maxPromptBytes {
		t.Errorf("AGENTS.md is %d bytes, over the %d-byte budget: shrink it (merge overlapping rules, state the class, or move the constraint into the harness config) instead of raising the ceiling", got, maxPromptBytes)
	}
}

// MaterializeSkills writes the embedded skills tree to disk (a subprocess cannot
// read embed.FS), preserving the <name>/SKILL.md layout the worker discovers.
func TestMaterializeSkills_WritesTreeToDisk(t *testing.T) {
	dest := t.TempDir()
	if err := MaterializeSkills(dest); err != nil {
		t.Fatalf("MaterializeSkills: %v", err)
	}
	// The checked-in dev set includes the langy-only github skill.
	skill := filepath.Join(dest, "github", "SKILL.md")
	info, err := os.Stat(skill)
	if err != nil {
		t.Fatalf("expected %s materialized on disk: %v", skill, err)
	}
	if info.IsDir() || info.Size() == 0 {
		t.Errorf("%s is not a non-empty file", skill)
	}
}

// The guided onboarding kickoff arrives as an ordinary user message; the
// routing table is what sends it to the native-only skill instead of the
// generic reply rules.
//
// @scenario "The agent prompt routes the kickoff to the skill"
func TestAgentsTemplate_RoutesGuidedKickoffToTheSkill(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	var row string
	for _, line := range strings.Split(tmpl, "\n") {
		if strings.HasPrefix(line, "|") && strings.Contains(line, "Guided onboarding kickoff") {
			row = line
		}
	}
	if row == "" {
		t.Fatal("AGENTS.md has no routing row for the guided onboarding kickoff")
	}
	for _, want := range []string{"`guided-onboarding`", "Let's set up", "`skill` tool"} {
		if !strings.Contains(row, want) {
			t.Errorf("the kickoff routing row lacks %q: %s", want, row)
		}
	}
	// The row sends the model to the skill and names no command of its own:
	// a command listed here gets run straight from the row, before the script
	// is ever read.
	if strings.Contains(row, "complete-path") {
		t.Errorf("the kickoff routing row names a command the model then runs instead of loading the skill: %s", row)
	}
}

// Alert, automation and Slack delivery requests used to fall to a "direct CLI"
// row, so the model never loaded the rules that keep Slack secrets out of the
// conversation. The row now names the automations skill, which ships embedded.
//
// @scenario "The prompt routes alert and Slack requests to the automations skill"
func TestAgentsTemplate_RoutesAlertsToTheAutomationsSkill(t *testing.T) {
	tmpl, err := AgentsTemplate()
	if err != nil {
		t.Fatalf("AgentsTemplate: %v", err)
	}
	var row string
	for _, line := range strings.Split(tmpl, "\n") {
		if strings.HasPrefix(line, "|") && strings.Contains(line, "alert me") {
			row = line
		}
	}
	if row == "" {
		t.Fatal("AGENTS.md has no routing row for alert requests")
	}
	for _, want := range []string{"`automations`", "Slack", "email", "langwatch trigger"} {
		if !strings.Contains(row, want) {
			t.Errorf("the alert routing row lacks %q: %s", want, row)
		}
	}
	dest := t.TempDir()
	if err := MaterializeSkills(dest); err != nil {
		t.Fatalf("MaterializeSkills: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "automations", "SKILL.md")); err != nil {
		t.Errorf("the automations skill the row names is not embedded: %v", err)
	}
}

// @scenario "The automations skill never asks for a Slack secret"
func TestAutomationsSkill_NeverTakesASlackSecret(t *testing.T) {
	dest := t.TempDir()
	if err := MaterializeSkills(dest); err != nil {
		t.Fatalf("MaterializeSkills: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dest, "automations", "SKILL.md"))
	if err != nil {
		t.Fatalf("read automations skill: %v", err)
	}
	skill := string(body)
	for _, want := range []string{
		"Never ask for one, never accept one pasted into the conversation",
		"never pass `--slack-webhook`",
		"--slack-connection",
		"Automations page",
	} {
		if !strings.Contains(skill, want) {
			t.Errorf("the automations skill lacks %q", want)
		}
	}
}

// A scheduled insights run names this skill in its brief and holds a read-only
// key, so the skill has to be embedded, and what it teaches has to be a card in
// the reply: no command, and so no permission, hands the findings back.
//
// @scenario "The daily-insights skill is embedded in the manager and hands findings back as a card"
func TestDailyInsightsSkill_IsEmbeddedAndAnswersWithACard(t *testing.T) {
	dest := t.TempDir()
	if err := MaterializeSkills(dest); err != nil {
		t.Fatalf("MaterializeSkills: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dest, "daily-insights", "SKILL.md"))
	if err != nil {
		t.Fatalf("read daily-insights skill: %v", err)
	}
	skill := string(body)
	for _, want := range []string{
		"name: daily-insights",
		"internal: true",
		"Only read. Do not create, change or delete anything",
		"```langy-card",
		`"kind": "insights"`,
		"never a tool call",
	} {
		if !strings.Contains(skill, want) {
			t.Errorf("the daily-insights skill lacks %q", want)
		}
	}
}

// QA on main found a chart placed on a board the user never named: the skills
// only said where ids come from, so the model picked one off the list.
//
// @scenario "Langy places a chart on the dashboard in context and asks when none is"
func TestChartSkills_PlaceOnTheDashboardInContextOrAsk(t *testing.T) {
	dest := t.TempDir()
	if err := MaterializeSkills(dest); err != nil {
		t.Fatalf("MaterializeSkills: %v", err)
	}
	// A widget goes on a Dashboards board; a saved chart on an Analytics Reports one.
	refusals := map[string]string{
		"dashboard-widgets": "Never choose a board for the user.",
		"lwql-charts":       "Never pick one from `langwatch dashboard list` on your own",
	}
	for name, refusal := range refusals {
		body, err := os.ReadFile(filepath.Join(dest, name, "SKILL.md"))
		if err != nil {
			t.Fatalf("read %s skill: %v", name, err)
		}
		skill := string(body)
		for _, want := range []string{
			"dashboard in the user's context",
			"ask which board with the `question` tool",
			refusal,
		} {
			if !strings.Contains(skill, want) {
				t.Errorf("the %s skill lacks %q", name, want)
			}
		}
	}
}

// Langy drives boards through the CLI: the skill must carry the create and
// delete commands, a confirm-before-delete rule and the not-released answer.
//
// @scenario "The dashboard-widgets skill never picks a board for the user"
// @scenario "The dashboard-widgets skill confirms before deleting a board or a widget"
// @scenario "The dashboard-widgets skill reads dashboards_not_released as Dashboards being off"
func TestDashboardWidgetsSkill_TeachesBoardCommands(t *testing.T) {
	dest := t.TempDir()
	if err := MaterializeSkills(dest); err != nil {
		t.Fatalf("MaterializeSkills: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(dest, "dashboard-widgets", "SKILL.md"))
	if err != nil {
		t.Fatalf("read dashboard-widgets skill: %v", err)
	}
	for _, want := range []string{
		"langwatch dashboards create",
		"langwatch dashboards delete <dashboardId>",
		"langwatch dashboards widgets create <dashboardId>",
		"Never pick a board for the user",
		"one option per board from `langwatch dashboards list`",
		"Confirm before any delete",
		"run the command only on Delete",
		"dashboards_not_released` means it is off: tell the user, do not retry",
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("the dashboard-widgets skill lacks %q", want)
		}
	}
}
