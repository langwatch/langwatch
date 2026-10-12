package apidiff

import (
	"context"
	"testing"
)

func TestAnalyticsURLIsTheSiblingRoute(t *testing.T) {
	if got := analyticsURL("https://app.feat-x.langwatch.localhost"); got != "https://analytics.feat-x.langwatch.localhost" {
		t.Errorf("analyticsURL = %q", got)
	}
	if got := analyticsURL("http://127.0.0.1:5560"); got != "" {
		t.Errorf("a stack not under haven has no analyticssim, got %q", got)
	}
}

func TestValidateAnalyticsNeedsProviderKindAndVerify(t *testing.T) {
	if problems := validateAnalytics("verify[0]", &scenarioAnalytics{Provider: "posthog", Kind: "event"}, true); len(problems) != 0 {
		t.Errorf("a valid step: %v", problems)
	}
	if problems := validateAnalytics("setup[0]", &scenarioAnalytics{Provider: "segment"}, false); len(problems) != 3 {
		t.Errorf("want three problems, got %v", problems)
	}
}

func TestAnalyticsScenariosAreDeferredWhenASideHasNoSim(t *testing.T) {
	analytic := scenario{ID: "a", Verify: []scenarioStep{{Analytics: &scenarioAnalytics{Provider: "posthog", Kind: "event"}}}}
	plain := scenario{ID: "p"}
	if !hasAnalytics(&analytic) || hasAnalytics(&plain) {
		t.Fatal("hasAnalytics misread the steps")
	}
	runner := newScenarioRunner(context.Background(), scenarioOptions{A: "http://127.0.0.1:1", B: "http://127.0.0.1:2"})
	defer runner.cancel()
	kept, deferred := runner.deferAnalyticsScenarios([]scenario{analytic, plain})
	if len(kept) != 1 || kept[0].ID != "p" || len(deferred) != 1 || deferred[0] != "a" {
		t.Errorf("kept %v, deferred %v", kept, deferred)
	}
	kept, deferred = runner.deferAnalyticsScenarios([]scenario{plain})
	if len(kept) != 1 || deferred != nil {
		t.Errorf("a run with no analytics scenario defers nothing: %v %v", kept, deferred)
	}
}
