package domain

import "regexp"

// Credentials is the per-conversation auth bundle the control plane sends in
// each /chat request. They are NEVER persisted — they live in the worker
// subprocess's env for the lifetime of the worker, and die with it. This is a
// pure value object: the workerpool adapter injects it into the subprocess
// env, and the httpapi adapter decodes it off the wire.
type Credentials struct {
	LangwatchAPIKey   string `json:"langwatchApiKey"`
	LLMVirtualKey     string `json:"llmVirtualKey"`
	GatewayBaseURL    string `json:"gatewayBaseUrl"`
	LangwatchEndpoint string `json:"langwatchEndpoint"`
	Model             string `json:"model,omitempty"`
	GithubToken       string `json:"githubToken,omitempty"`
	GithubLogin       string `json:"githubLogin,omitempty"`
}

// Complete reports whether the mandatory credential fields are present. The
// per-worker LangWatch key, the LLM virtual key, and both base URLs are
// required to spawn a functional worker.
func (c Credentials) Complete() bool {
	return c.LangwatchAPIKey != "" && c.LLMVirtualKey != "" &&
		c.GatewayBaseURL != "" && c.LangwatchEndpoint != ""
}

// CredentialSignature is a stable fingerprint of the credential capabilities a
// worker was spawned with. A worker whose capability set has changed since
// spawn (model swap, GH token added/removed) cannot be reused — reusing would
// mean:
//   - A worker that got a GH_TOKEN at spawn keeps it across later turns where
//     the control plane denied the daily PR cap (token's still in the
//     subprocess env; the model can still call `gh pr create`).
//   - A user switching the model picker mid-conversation appears to succeed but
//     execution stays on the originally-spawned model because setupWorkerHome
//     only ran once.
//
// The signature is compared on every reuse; mismatch → kill + respawn.
type CredentialSignature struct {
	Model         string
	HasGithubAuth bool
}

// SignatureOf derives the comparable signature from a credentials payload.
// GithubLogin is deliberately excluded — it is a display label, not a
// capability, so a login change without a token must NOT force a recycle.
func SignatureOf(creds Credentials) CredentialSignature {
	return CredentialSignature{
		Model:         creds.Model,
		HasGithubAuth: creds.GithubToken != "",
	}
}

// conversationIDPattern restricts conversationId to a filesystem-safe charset
// before it ever reaches filepath.Join — otherwise values like "../../etc"
// escape SESSIONS_ROOT.
var conversationIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// IsValidConversationID is true when value is safe to use as a path segment.
func IsValidConversationID(value string) bool {
	return conversationIDPattern.MatchString(value)
}
