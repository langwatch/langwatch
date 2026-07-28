// Package github is the GitHub Capability (app.Capability): it grants a worker
// the ability to open bot-authored PRs and push branches via a short-lived
// GitHub App INSTALLATION token minted per turn by the control plane. The token
// rides into the worker as GH_TOKEN, which `gh` reads from env (never disk) and
// `gh auth git-credential` proxies to git pushes, so nothing is written to the
// filesystem. GITHUB_LOGIN is the requesting user's handle, used for the
// Co-authored-by commit trailer and the "Requested by @<login>" PR note. See
// specs/langy/langy-github-prs.feature.
package github

import "github.com/langwatch/langwatch/services/langyagent/app"

// Capability is the GitHub access a worker was granted for the turn: the minted
// installation token, the requesting user's login (an attribution label), and
// the token's repository/permission scope key. Absent when the turn carried no
// token — the capability is then inert and contributes nothing.
type Capability struct {
	token     string
	login     string
	repoScope string
}

// compile-time proof Capability satisfies the app port.
var _ app.Capability = Capability{}

// New builds the GitHub capability from the turn's credentials. An empty token
// makes the capability inert (Contribute returns nil), which is how a turn with
// no GitHub access is represented — no branch at the call site. repoScope is the
// token's repository/permission scope key: a change to it makes the worker
// signature differ so the worker re-warms rather than reusing a token scoped to
// different repositories.
func New(token, login, repoScope string) Capability {
	return Capability{token: token, login: login, repoScope: repoScope}
}

// Name identifies the capability in logs and telemetry.
func (Capability) Name() string { return "github" }

// Contribute injects GH_TOKEN + GITHUB_LOGIN when a token is present, or nil when
// there is none. GH_TOKEN is what `gh`/`git` authenticate with; GITHUB_LOGIN is
// the login the skills surface in their output.
func (c Capability) Contribute() []string {
	if c.token == "" {
		return nil
	}
	return []string{
		"GH_TOKEN=" + c.token,
		"GITHUB_LOGIN=" + c.login,
	}
}

// SignatureKey folds GitHub presence AND repository scope into the worker
// credential signature: a worker that booted with a token keeps GH_TOKEN in its
// env and can still open PRs, so it must not be reused for a turn that carries no
// GitHub access (and vice versa), NOR for a turn whose token is scoped to a
// different repository set. Never the token value — only presence + scope key —
// so it is identical whether computed from a real token (spawn) or the probe's
// boolean + scope key. In lockstep with Contribute: non-empty exactly when
// Contribute is non-nil.
func (c Capability) SignatureKey() string {
	if c.token == "" {
		return ""
	}
	if c.repoScope == "" {
		return "github"
	}
	return "github:" + c.repoScope
}
