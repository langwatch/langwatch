package apidiff

import "testing"

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
