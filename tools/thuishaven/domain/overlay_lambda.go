package domain

import "fmt"

// LambdaFleetConfig is the placeholder NLP Lambda fleet haven names when
// lambdasim runs: the workflow module needs every field, and lambdasim reads none.
const LambdaFleetConfig = `{"AWS_REGION":"us-east-1","AWS_ACCESS_KEY_ID":"lambdasim","AWS_SECRET_ACCESS_KEY":"lambdasim",` +
	`"role_arn":"arn:aws:iam::000000000000:role/lambdasim","image_uri":"lambdasim/nlpgo:local",` +
	`"cache_bucket":"langwatch","subnet_ids":[],"security_group_ids":[]}`

// LambdaFleetEnv names a fleet and points the AWS SDK's Lambda and CloudWatch
// Logs clients at lambdasim on port, or nil when the developer named a fleet of
// their own. The SDK reads the AWS_ENDPOINT_URL_<SERVICE> overrides itself.
func LambdaFleetEnv(resolved map[string]string, port int) []string {
	if resolved["LANGWATCH_NLP_LAMBDA_CONFIG"] != "" {
		return nil
	}
	endpoint := fmt.Sprintf("http://127.0.0.1:%d", port)
	return []string{
		"LANGWATCH_NLP_LAMBDA_CONFIG=" + LambdaFleetConfig,
		"AWS_ENDPOINT_URL_LAMBDA=" + endpoint,
		"AWS_ENDPOINT_URL_CLOUDWATCH_LOGS=" + endpoint,
	}
}
