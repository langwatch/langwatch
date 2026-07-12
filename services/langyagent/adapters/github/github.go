// Package github is the GitHub Capability (app.Capability): it grants a worker
// the ability to act on GitHub as the requesting user — open PRs, push branches —
// via the user's short-lived user-to-server token. The token rides into the
// worker as GH_TOKEN, which `gh` reads from env (never disk) and
// `gh auth git-credential` proxies to git pushes, so nothing is written to the
// filesystem. See specs/assistant/langy-github-prs.feature.
package github

import "github.com/langwatch/langwatch/services/langyagent/app"

// Capability is the GitHub access a worker was granted for the turn: the user's
// token plus their login (a display label). Absent when the turn carried no token
// — the capability is then inert and contributes nothing.
type Capability struct {
	token string
	login string
}

// compile-time proof Capability satisfies the app port.
var _ app.Capability = Capability{}

// New builds the GitHub capability from the turn's credentials. An empty token
// makes the capability inert (Contribute returns nil), which is how a turn with
// no GitHub access is represented — no branch at the call site.
func New(token, login string) Capability {
	return Capability{token: token, login: login}
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
