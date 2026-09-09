package havenrun

import (
	"strings"
	"testing"
	"time"
)

func TestSlugIsPrefixedAndSanitized(t *testing.T) {
	got := Slug("apidiff", "20260909t2230", "branch")
	if got != "apidiff-20260909t2230-branch" {
		t.Fatalf("Slug = %q", got)
	}
	if got := Slug("visualdiff", "20260909T22:30", "candidate"); got != "visualdiff-20260909t22-30-candidate" {
		t.Fatalf("Slug did not sanitize: %q", got)
	}
}

func TestRunIDDerivesFromTheWorkRootBaseName(t *testing.T) {
	cases := []struct{ root, want string }{
		{"/repos/langwatch/.apidiff/20260909-143130", "20260909_143130"},
		{"/repos/langwatch/.visualdiff/20260909-143130/", "20260909_143130"},
		{"", "run"},
		{"/", "run"},
	}
	for _, testCase := range cases {
		if got := RunID(testCase.root); got != testCase.want {
			t.Errorf("RunID(%q) = %q, want %q", testCase.root, got, testCase.want)
		}
	}
}

func TestSelected(t *testing.T) {
	cases := []struct {
		name                               string
		onPath, noHaven, alternative, want bool
	}{
		{name: "on PATH with nothing else set", onPath: true, want: true},
		{name: "opted out", onPath: true, noHaven: true},
		{name: "not installed"},
		{name: "an explicit alternative was named", onPath: true, alternative: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Selected(testCase.onPath, testCase.noHaven, testCase.alternative); got != testCase.want {
				t.Errorf("Selected = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestEnvStripsManagedKeysAndAppendsTheSlug(t *testing.T) {
	inherit := []string{
		"HOME=/home/user",
		"DATABASE_URL=postgres://real:secret@127.0.0.1:5432/lw_feat_x",
		"CLICKHOUSE_URL=http://127.0.0.1:8123/lw_feat_x",
		"REDIS_URL=redis://127.0.0.1:6379",
		"REDIS_DB_INDEX=13",
		"LANGWATCH_SLUG=someone-elses-stack",
	}
	env := Env(inherit, "apidiff-20260909t2230-branch", EnvOptions{})
	joined := strings.Join(env, "\n")
	for _, key := range ManagedEnvKeys {
		if strings.Contains(joined, key+"=someone-elses-stack") {
			t.Errorf("a managed key leaked through unstripped: %s\n%s", key, joined)
		}
	}
	if !strings.Contains(joined, "HOME=/home/user") {
		t.Errorf("the inherited environment was dropped:\n%s", joined)
	}
	if !strings.Contains(joined, "LANGWATCH_SLUG=apidiff-20260909t2230-branch") {
		t.Errorf("the slug was not set:\n%s", joined)
	}
}

func TestEnvHonoursExtraManagedKeysAndExtras(t *testing.T) {
	env := Env([]string{"LANGWATCH_INSTANCE_ADMIN_API_KEY=leaked"}, "slug", EnvOptions{
		ExtraManagedKeys: []string{"LANGWATCH_INSTANCE_ADMIN_API_KEY"},
		Extra:            []string{"LANGWATCH_INSTANCE_ADMIN_API_KEY=throwaway"},
	})
	joined := strings.Join(env, "\n")
	if strings.Contains(joined, "LANGWATCH_INSTANCE_ADMIN_API_KEY=leaked") {
		t.Errorf("the inherited admin key was not stripped:\n%s", joined)
	}
	if !strings.Contains(joined, "LANGWATCH_INSTANCE_ADMIN_API_KEY=throwaway") {
		t.Errorf("the extra was not appended:\n%s", joined)
	}
}

func TestArgvBuilders(t *testing.T) {
	if got := strings.Join(UpArgs(), " "); got != "up --agent --detach" {
		t.Errorf("UpArgs = %q", got)
	}
	if got := strings.Join(StatusArgs(), " "); got != "status --agent --json" {
		t.Errorf("StatusArgs = %q", got)
	}
	if got := strings.Join(DestroyArgs("slug-1"), " "); got != "destroy slug-1 --agent --yes" {
		t.Errorf("DestroyArgs = %q", got)
	}
	if got := strings.Join(BackendLogArgs("slug-1"), " "); got != "logs backend --agent --stack slug-1" {
		t.Errorf("BackendLogArgs = %q", got)
	}
}

func TestParseStatus(t *testing.T) {
	status, err := ParseStatus([]byte(`{"stacks":[{"slug":"a","apiPort":6560,"live":true,"lanes":[{"name":"backend","listening":true}],"services":[{"name":"app","url":"https://app.a.langwatch.localhost"}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(status.Stacks) != 1 || status.Stacks[0].Slug != "a" || status.Stacks[0].APIPort != 6560 {
		t.Fatalf("status = %+v", status)
	}
	if _, err := ParseStatus([]byte("not json")); err == nil {
		t.Fatal("malformed status was accepted")
	}
}

func TestStackReadyRequiresEveryNamedLaneListening(t *testing.T) {
	status := Status{Stacks: []StackStatus{{
		Slug: "s1", Live: true,
		Lanes: []LaneStatus{{Name: "ui", Listening: true}, {Name: "backend", Listening: false}},
	}}}
	if _, ready := StackReady(status, "s1", "ui", "backend"); ready {
		t.Fatal("a stack missing one required lane was reported ready")
	}
	if _, ready := StackReady(status, "s1", "ui"); !ready {
		t.Fatal("a stack whose only required lane is listening was reported not ready")
	}
	if _, ready := StackReady(status, "other", "ui"); ready {
		t.Fatal("a stack that was not asked about was reported ready")
	}

	dead := Status{Stacks: []StackStatus{{Slug: "s1", Live: false, Lanes: []LaneStatus{{Name: "ui", Listening: true}}}}}
	if _, ready := StackReady(dead, "s1", "ui"); ready {
		t.Fatal("a stack whose launcher is dead was reported ready")
	}
}

func TestStackStatusServiceURL(t *testing.T) {
	stack := StackStatus{Services: []ServiceItem{{Name: "app", URL: "https://app.slug.langwatch.localhost"}, {Name: "gateway", URL: ""}}}
	if url, ok := stack.ServiceURL("app"); !ok || url != "https://app.slug.langwatch.localhost" {
		t.Errorf("ServiceURL(app) = %q, %v", url, ok)
	}
	if _, ok := stack.ServiceURL("gateway"); ok {
		t.Error("a service with an empty URL must not be reported as found")
	}
	if _, ok := stack.ServiceURL("nlp"); ok {
		t.Error("a service that was never listed must not be reported as found")
	}
}

func TestPollDelayNeverOutlastsTheDeadline(t *testing.T) {
	deadline := time.Now().Add(200 * time.Millisecond)
	if got := PollDelay(deadline, time.Second); got > 250*time.Millisecond {
		t.Errorf("PollDelay = %s, want capped near the remaining time", got)
	}
	if got := PollDelay(time.Now().Add(time.Hour), time.Second); got != time.Second {
		t.Errorf("PollDelay = %s, want the poll interval when plenty of time remains", got)
	}
}

func TestLastLinesKeepsOnlyTheTail(t *testing.T) {
	text := "one\ntwo\nthree\nfour\n"
	if got := LastLines(text, 2); got != "three\nfour" {
		t.Errorf("LastLines = %q", got)
	}
	if got := LastLines("solo line", 40); got != "solo line" {
		t.Errorf("LastLines = %q", got)
	}
}
