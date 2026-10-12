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
	env := OutboundProviderEnv(map[string]string{}, endpoint, 6970)
	for _, want := range []string{
		"SLACK_CHANNEL_SIGNUPS=" + endpoint + "/services/T0SIM/B0SIGNUPS/x",
		"SLACK_PLAN_LIMIT_CHANNEL=" + endpoint + "/services/T0SIM/B0PLANLIMIT/x",
		"SLACK_CHANNEL_SUBSCRIPTIONS=" + endpoint + "/services/T0SIM/B0SUBSCRIPTIONS/x",
		"SLACK_CHANNEL_SELF_HOSTED=" + endpoint + "/services/T0SIM/B0SELFHOSTED/x",
		"SLACK_API_BASE=" + endpoint + "/api",
		"SLACK_WEBHOOK_BASE=" + endpoint,
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
	}, "https://outbound.x.langwatch.localhost", 6970)
	for _, line := range env {
		if strings.HasPrefix(line, "SLACK_CHANNEL_SIGNUPS=") || strings.HasPrefix(line, "WEBHOOKS_UNSAFE_ALLOW_LOCAL_URLS=") {
			t.Errorf("overlay %v overrides a setting .env chose", env)
		}
	}
	if len(env) != 16 {
		t.Errorf("overlay %v should still set the other three Slack channels, both Slack addresses, the six vendor bases, the two Codex bases, the STS base and the two Azure Blob bases", env)
	}
}

// @scenario "The overlay points the product's Slack addresses at outboundsim"
func TestOutboundProviderEnvPointsSlackAddressesAtOutboundsimUnlessChosen(t *testing.T) {
	endpoint := "https://outbound.feat-x.langwatch.localhost"
	env := OutboundProviderEnv(map[string]string{}, endpoint, 6970)
	for _, want := range []string{"SLACK_API_BASE=" + endpoint + "/api", "SLACK_WEBHOOK_BASE=" + endpoint} {
		if !slices.Contains(env, want) {
			t.Errorf("overlay %v is missing %s", env, want)
		}
	}
	own := OutboundProviderEnv(map[string]string{"SLACK_API_BASE": "https://slack.com/api", "SLACK_WEBHOOK_BASE": "https://hooks.slack.com"}, endpoint, 6970)
	for _, line := range own {
		if strings.HasPrefix(line, "SLACK_API_BASE=") || strings.HasPrefix(line, "SLACK_WEBHOOK_BASE=") {
			t.Errorf("overlay %v overrides a Slack address .env chose", own)
		}
	}
}

// @scenario "The overlay points the governance pull vendors at outboundsim"
func TestOutboundProviderEnvPointsPullVendorsAtOutboundsimUnlessChosen(t *testing.T) {
	endpoint := "https://outbound.feat-x.langwatch.localhost"
	direct := "http://127.0.0.1:6970"
	env := OutboundProviderEnv(map[string]string{}, endpoint, 6970)
	for _, want := range []string{
		"DATABRICKS_WORKSPACE_BASE=" + direct,
		"DATAVERSE_ENVIRONMENT_BASE=" + direct + "/dataverse",
		"OPENAI_ADMIN_API_BASE=" + direct + "/openai",
		"ANTHROPIC_ADMIN_API_BASE=" + direct + "/anthropic",
		"MICROSOFT_LOGIN_BASE=" + direct + "/microsoft-login",
		"MICROSOFT_GRAPH_API_BASE=" + direct + "/microsoft-graph",
		"CODEX_OAUTH_ISSUER=" + direct + "/codex-auth",
		"CODEX_API_BASE=" + direct + "/codex-api",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("overlay %v is missing %s", env, want)
		}
	}
	own := OutboundProviderEnv(map[string]string{"OPENAI_ADMIN_API_BASE": "https://api.openai.com", "DATABRICKS_WORKSPACE_BASE": "https://own.example"}, endpoint, 6970)
	for _, line := range own {
		if strings.HasPrefix(line, "OPENAI_ADMIN_API_BASE=") || strings.HasPrefix(line, "DATABRICKS_WORKSPACE_BASE=") {
			t.Errorf("overlay %v overrides a vendor base .env chose", own)
		}
	}
}

// @scenario "The overlay points managed Bedrock's STS and Azure Blob storage at outboundsim"
func TestOutboundProviderEnvPointsSTSAndAzureBlobAtOutboundsimUnlessChosen(t *testing.T) {
	endpoint := "https://outbound.feat-x.langwatch.localhost"
	env := OutboundProviderEnv(map[string]string{}, endpoint, 6970)
	for _, want := range []string{
		"MANAGED_BEDROCK_STS_BASE=http://127.0.0.1:6970/sts",
		"AZURE_BLOB_ENDPOINT=" + endpoint + "/azure-blob/simaccount",
		"AZURE_BLOB_AUTHORITY_HOST=" + endpoint + "/azure-login",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("overlay %v is missing %s", env, want)
		}
	}
	named := OutboundProviderEnv(map[string]string{"AZURE_BLOB_ACCOUNT_NAME": "otheraccount"}, endpoint, 6970)
	if !slices.Contains(named, "AZURE_BLOB_ENDPOINT="+endpoint+"/azure-blob/otheraccount") {
		t.Errorf("overlay %v should address the account .env names", named)
	}
	own := OutboundProviderEnv(map[string]string{
		"MANAGED_BEDROCK_STS_BASE": "https://sts.us-east-1.amazonaws.com",
		"AZURE_BLOB_ENDPOINT":      "https://acct.blob.core.windows.net",
	}, endpoint, 6970)
	for _, line := range own {
		if strings.HasPrefix(line, "MANAGED_BEDROCK_STS_BASE=") || strings.HasPrefix(line, "AZURE_BLOB_ENDPOINT=") {
			t.Errorf("overlay %v overrides a base .env chose", own)
		}
	}
}
