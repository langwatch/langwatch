package domain

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "haven runs analyticssim only when the worktree asks for it"
func TestAnalyticsProviderEnvPointsBothVendorsAtAnalyticssim(t *testing.T) {
	if DefaultSelection().Analytics {
		t.Fatal("analytics is on in a fresh worktree's selection; it must be opt-in")
	}
	sel, err := applySelectionDelta(DefaultSelection(), AnalyticsService, true)
	if err != nil || !sel.Analytics {
		t.Fatalf("+analytics = %+v, %v", sel, err)
	}
	endpoint := "https://analytics.feat-x.langwatch.localhost"
	env := AnalyticsProviderEnv(map[string]string{"POSTHOG_KEY": "phc_real"}, endpoint)
	want := []string{
		"POSTHOG_HOST=" + endpoint,
		"CUSTOMER_IO_BASE_URL=" + endpoint + "/v1", "CUSTOMER_IO_API_KEY=analyticssim",
	}
	if !slices.Equal(env, want) {
		t.Errorf("overlay = %v, want %v", env, want)
	}
}

// @scenario "A developer's own analytics host wins"
func TestAnalyticsProviderEnvLeavesAChosenHostAlone(t *testing.T) {
	env := AnalyticsProviderEnv(map[string]string{"POSTHOG_HOST": "https://eu.i.posthog.com"}, "https://analytics.x.langwatch.localhost")
	for _, line := range env {
		if strings.HasPrefix(line, "POSTHOG_") {
			t.Errorf("overlay %v overrides the PostHog host .env chose", env)
		}
	}
	if !slices.Contains(env, "CUSTOMER_IO_BASE_URL=https://analytics.x.langwatch.localhost/v1") {
		t.Errorf("overlay %v should still point Customer.io at analyticssim", env)
	}
}
