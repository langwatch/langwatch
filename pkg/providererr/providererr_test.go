package providererr

import "testing"

func TestAccountExhausted(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   bool
	}{
		{"anthropic credit-balance 400", 400, `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`, true},
		{"openai insufficient_quota code", 429, `{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}`, true},
		{"openai insufficient_quota type only", 403, `{"error":{"message":"quota","type":"insufficient_quota"}}`, true},
		{"generic 402 payment required", 402, `{"error":{"message":"payment required"}}`, true},
		{"transient rate_limit 429", 429, `{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}`, false},
		{"plain 400 bad request", 400, `{"error":{"message":"messages: field required","type":"invalid_request_error"}}`, false},
		{"provider 503", 503, `{"error":{"message":"overloaded"}}`, false},
		{"500 internal", 500, `{"error":{"message":"oops"}}`, false},
		{"5xx naming insufficient_quota", 503, `{"error":{"code":"insufficient_quota"}}`, false},
		{"gateway governance message on a 400", 400, `{"type":"error","error":{"message":"` + GatewayAccountExhaustedMessage + `","type":"invalid_request_error"}}`, true},
		{"gateway exhaustion code on a 400", 400, `{"error":{"message":"any wording","code":"` + GatewayAccountExhaustedCode + `"}}`, true},
		{"gateway exhaustion code on a 5xx", 502, `{"error":{"code":"` + GatewayAccountExhaustedCode + `"}}`, false},
		{"gateway governance message on a 403", 403, `{"error":{"message":"` + GatewayAccountExhaustedMessage + `"}}`, true},
		{"credit balance in an in-stream error event", 0, `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`, true},
		{"credit balance on a 404", 404, `{"error":{"message":"Your credit balance is too low"}}`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := AccountExhausted(c.status, []byte(c.body)); got != c.want {
				t.Fatalf("AccountExhausted(%d, %s) = %v, want %v", c.status, c.body, got, c.want)
			}
		})
	}
}

func TestKeyRejected(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   bool
	}{
		{"anthropic 401", 401, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`, true},
		{"bedrock 403", 403, `{"message":"denied"}`, true},
		{"google invalid key 400", 400, `{"error":{"code":400,"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}`, true},
		{"openai invalid_api_key 400", 400, `{"error":{"code":"invalid_api_key"}}`, true},
		{"anthropic thinking shape 400", 400, `{"type":"error","error":{"type":"invalid_request_error","message":"thinking.type.enabled is not supported"}}`, false},
		{"rate limit 429", 429, `{"error":{"type":"rate_limit_error"}}`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := KeyRejected(c.status, []byte(c.body)); got != c.want {
				t.Fatalf("KeyRejected(%d, %s) = %v, want %v", c.status, c.body, got, c.want)
			}
		})
	}
}
