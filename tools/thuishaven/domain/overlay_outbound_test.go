package domain

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "haven runs outboundsim only when the worktree asks for it"
func TestOutboundProviderEnvPointsSlackAtOutboundsimAndAdmitsLocalWebhooks(t *testing.T) {
	if DefaultSelection().Outbound {
		t.Fatal("outbound is on in a fresh worktree's selection; it must be opt-in")
	}
	sel, err := applySelectionDelta(DefaultSelection(), OutboundService, true)
	if err != nil || !sel.Outbound {
		t.Fatalf("+outbound = %+v, %v", sel, err)
	}
	endpoint := "https://outbound.feat-x.langwatch.localhost"
	env := OutboundProviderEnv(map[string]string{}, endpoint)
	for _, want := range []string{
		"SLACK_CHANNEL_SIGNUPS=" + endpoint + "/services/T0SIM/B0SIGNUPS/x",
		"SLACK_PLAN_LIMIT_CHANNEL=" + endpoint + "/services/T0SIM/B0PLANLIMIT/x",
		"SLACK_CHANNEL_SUBSCRIPTIONS=" + endpoint + "/services/T0SIM/B0SUBSCRIPTIONS/x",
		"SLACK_CHANNEL_SELF_HOSTED=" + endpoint + "/services/T0SIM/B0SELFHOSTED/x",
		"WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=1",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("overlay %v is missing %s", env, want)
		}
	}
}

// @scenario "A developer's own Slack and webhook settings win"
func TestOutboundProviderEnvLeavesChosenSettingsAlone(t *testing.T) {
	env := OutboundProviderEnv(map[string]string{
		"SLACK_CHANNEL_SIGNUPS":            "https://hooks.slack.com/services/own",
		"WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS": "0",
	}, "https://outbound.x.langwatch.localhost")
	for _, line := range env {
		if strings.HasPrefix(line, "SLACK_CHANNEL_SIGNUPS=") || strings.HasPrefix(line, "WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=") {
			t.Errorf("overlay %v overrides a setting .env chose", env)
		}
	}
	if len(env) != 3 {
		t.Errorf("overlay %v should still set the other three Slack channels", env)
	}
}
