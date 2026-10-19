package domain

import (
	"encoding/json"
	"slices"
	"testing"
)

// @scenario "haven runs lambdasim only when the worktree asks for it"
func TestLambdaFleetEnvPointsTheSDKAtLambdasim(t *testing.T) {
	env := LambdaFleetEnv(map[string]string{}, 45594)
	for _, want := range []string{
		"LANGWATCH_NLP_LAMBDA_CONFIG=" + LambdaFleetConfig,
		"AWS_ENDPOINT_URL_LAMBDA=http://127.0.0.1:45594",
		"AWS_ENDPOINT_URL_CLOUDWATCH_LOGS=http://127.0.0.1:45594",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("env %v lacks %s", env, want)
		}
	}
	var fleet map[string]any
	if err := json.Unmarshal([]byte(LambdaFleetConfig), &fleet); err != nil {
		t.Fatalf("the placeholder fleet is not JSON: %v", err)
	}
	for _, field := range []string{"AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "role_arn", "image_uri", "cache_bucket", "subnet_ids", "security_group_ids"} {
		if _, ok := fleet[field]; !ok {
			t.Errorf("the placeholder fleet lacks %s, so the workflow module would refuse it", field)
		}
	}
	if env := LambdaFleetEnv(map[string]string{"LANGWATCH_NLP_LAMBDA_CONFIG": "{}"}, 45594); env != nil {
		t.Errorf("a fleet the developer named was overridden: %v", env)
	}
}
