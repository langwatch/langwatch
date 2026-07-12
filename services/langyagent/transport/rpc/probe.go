package rpc

// probeRequest asks whether a worker with these capabilities is already running.
//
// Note what is NOT here: a LangWatch session key. That is the entire point. The
// worker signature is derived from capabilities alone — model, whether a GitHub
// token is present, and the egress allow-list — so the control plane can ask this
// question BEFORE it decides whether to mint anything.
//
// The capability fields are sent raw rather than as a pre-computed signature so
// the canonicalisation (egress allow-list sorting/normalising) stays in ONE place
// — domain.SignatureOf, here — instead of being reimplemented in TypeScript where
// it could silently drift and cause every probe to miss.
type probeRequest struct {
	ConversationID string `json:"conversationId" validate:"required"`
	Model          string `json:"model,omitempty"`
	// HasGithubAuth, not the token: the probe never needs the secret, only whether
	// the worker would have had one. Sending the token here would put a credential
	// on the wire for a question that does not need it.
	HasGithubAuth   bool     `json:"hasGithubAuth,omitempty"`
	EgressAllowlist []string `json:"egressAllowlist,omitempty"`
}

type probeResponse struct {
	// Alive: a worker is running for this conversation whose capabilities match.
	// The control plane reads this as "you do not need to mint a session key".
	Alive bool `json:"alive"`
}

// githubTokenSentinel turns the boolean the probe carries back into the shape
// SignatureOf reads (`GithubToken != ""`). The value is never used as a
// credential — it exists only so the signature is computed by the one function
// that owns that logic, rather than by a second copy of the rule that could drift
// from it.
func githubTokenSentinel(hasGithubAuth bool) string {
	if hasGithubAuth {
		return "present"
	}
	return ""
}
