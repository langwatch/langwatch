//go:build live_bedrock

package matrix

import "testing"

// TestBedrock_SimpleCompletion verifies AWS Bedrock through the inline-
// credentials path. Bedrock authenticates with raw IAM creds (no api_key)
// and the model id is namespaced with the bedrock/ prefix.
//
// Required env:
//   - BEDROCK_AWS_ACCESS_KEY_ID
//   - BEDROCK_AWS_SECRET_ACCESS_KEY
//   - BEDROCK_AWS_REGION (defaults to us-east-1)
//   - BEDROCK_MODEL (e.g. anthropic.claude-3-sonnet-20240229-v1:0)
func TestBedrock_SimpleCompletion(t *testing.T) {
	mc := loadContext(t)
	akid := requireEnv(t, "BEDROCK_AWS_ACCESS_KEY_ID")
	sak := requireEnv(t, "BEDROCK_AWS_SECRET_ACCESS_KEY")
	region := envOrDefault("BEDROCK_AWS_REGION", "us-east-1")
	// Default uses an on-demand-capable model id. Bedrock requires
	// inference-profile prefixes (us.* / eu.*) for many newer models;
	// override BEDROCK_MODEL when running against a region/profile that
	// expects a specific format for your account.
	modelTail := envOrDefault("BEDROCK_MODEL", "anthropic.claude-3-haiku-20240307-v1:0")
	exec := newExecutor(t, mc)

	resp := runSimpleCompletion(t, exec, "bedrock/"+modelTail, map[string]any{
		"aws_access_key_id":     akid,
		"aws_secret_access_key": sak,
		"aws_region_name":       region,
	})
	assertContent(t, resp)
}
