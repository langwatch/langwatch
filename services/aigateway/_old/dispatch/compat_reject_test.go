package dispatch

import "testing"

// TestClassifyCompatRejection locks the openai-param-compat.feature §v1
// observability contract: the gateway classifies upstream 4xx errors
// that look like legacy-client incompatibilities so operators can
// `rate(gateway_upstream_compat_rejected_total[5m])` before deciding
// whether to ship the v1.1 translation layer.
//
// Both literal OpenAI and Azure OpenAI emit this error verbatim on
// gpt-5-* models. Future compat reasons slot in alongside.
func TestClassifyCompatRejection(t *testing.T) {
	cases := []struct {
		name   string
		msg    string
		reason string
	}{
		{
			name:   "openai gpt-5 max_tokens rejection",
			msg:    "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
			reason: "legacy_max_tokens",
		},
		{
			name:   "case-insensitive — Azure 4xx in mixed case",
			msg:    "Max_Tokens is no longer supported; please use Max_Completion_Tokens.",
			reason: "legacy_max_tokens",
		},
		{
			name:   "generic 4xx not a compat mismatch",
			msg:    "Invalid request: temperature must be between 0 and 2.",
			reason: "",
		},
		{
			name:   "mentions only max_tokens — ambiguous, not classified",
			msg:    "max_tokens must be an integer",
			reason: "",
		},
		{
			name:   "mentions only max_completion_tokens — ambiguous",
			msg:    "max_completion_tokens is required",
			reason: "",
		},
		{
			name:   "empty message",
			msg:    "",
			reason: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyCompatRejection(tc.msg); got != tc.reason {
				t.Errorf("classifyCompatRejection(%q) = %q; want %q", tc.msg, got, tc.reason)
			}
		})
	}
}
