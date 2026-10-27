package havenrun

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestArgvBuilders(t *testing.T) {
	if got := strings.Join(StatusArgs(), " "); got != "status --agent --json stacks" {
		t.Errorf("StatusArgs = %q", got)
	}
}

func TestParseStatus(t *testing.T) {
	status, err := ParseStatus([]byte(`{"stacks":[{"slug":"a","apiPort":6560,"live":true,"lanes":[{"name":"api","listening":true}],"services":[{"name":"app","url":"https://app.a.langwatch.localhost"}]}]}`))
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
		Lanes: []LaneStatus{{Name: "ui", Listening: true}, {Name: "api", Listening: false}},
	}}}
	if _, ready := StackReady(status, "s1", "ui", "api"); ready {
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

func TestStackReadyResolvesUIAndBackendToTheAppLaneOnAMonolithStack(t *testing.T) {
	status := Status{Stacks: []StackStatus{{
		Slug: "s1", Live: true, Layout: domain.LayoutMonolith,
		Lanes:    []LaneStatus{{Name: AppService, Listening: true}},
		Services: []ServiceItem{{Name: AppService, URL: "https://app.s1.langwatch.localhost"}},
	}}}
	stack, ready := StackReady(status, "s1", UILane, BackendLane)
	if !ready {
		t.Fatal("a monolith stack whose app lane is listening must be ready for a caller asking about ui+backend")
	}
	if !stack.IsMonolith() {
		t.Error("IsMonolith must report true for a stack whose layout is monolith")
	}
	if url, ok := stack.ServiceURL(AppService); !ok || url != "https://app.s1.langwatch.localhost" {
		t.Errorf("ServiceURL(AppService) = %q, %v", url, ok)
	}

	down := Status{Stacks: []StackStatus{{
		Slug: "s1", Live: true, Layout: domain.LayoutMonolith,
		Lanes: []LaneStatus{{Name: AppService, Listening: false}},
	}}}
	if _, ready := StackReady(down, "s1", BackendLane); ready {
		t.Fatal("a monolith stack whose app lane is down must not be ready")
	}

	modular := Status{Stacks: []StackStatus{{
		Slug: "s2", Live: true,
		Lanes: []LaneStatus{{Name: UILane, Listening: true}, {Name: BackendLane, Listening: true}},
	}}}
	if stack, _ := StackReady(modular, "s2", UILane, BackendLane); stack.IsMonolith() {
		t.Error("a stack with no layout recorded must read as modular, not monolith")
	}
}

func TestLogArgs(t *testing.T) {
	if got := strings.Join(LogArgs(AppService, "slug-1"), " "); got != "logs app --agent --stack slug-1" {
		t.Errorf("LogArgs = %q", got)
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

func TestTheAPILaneAnswersForTheBackend(t *testing.T) {
	status := Status{Stacks: []StackStatus{{
		Slug: "s1", Live: true,
		Lanes: []LaneStatus{{Name: "ui", Listening: true}, {Name: "api", Listening: true}},
	}}}
	if _, ready := StackReady(status, "s1", UILane, BackendLane); !ready {
		t.Fatal("a stack whose api lane listens is not ready")
	}
}
