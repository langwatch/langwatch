// Package github is the GitHub Capability (app.Capability): it grants a worker
// the ability to open bot-authored PRs and push branches via a short-lived
// GitHub App INSTALLATION token minted per turn by the control plane. The token
// rides into the worker as GH_TOKEN, which `gh` reads from env (never disk) and
// `gh auth git-credential` proxies to git pushes, so nothing is written to the
// filesystem. GITHUB_LOGIN is the requesting user's handle, used for the
// Co-authored-by commit trailer and the "Requested by @<login>" PR note. See
// specs/langy/langy-github-prs.feature.
package github

import (
	"strings"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// Capability is the GitHub access a worker was granted for the turn: the minted
// installation token, the requesting user's login (an attribution label), and
// the token's repository/permission scope key. Absent when the turn carried no
// token — the capability is then inert and contributes nothing.
type Capability struct {
	token     string
	login     string
	repoScope string
	host      string
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

// WithHost points the worker at a GitHub host other than github.com: blank keeps
// github.com. Dev stacks name their GitHub stand-in here (LANGY_GITHUB_HOST).
func (c Capability) WithHost(host string) Capability {
	c.host = strings.TrimSpace(host)
	return c
}

// Name identifies the capability in logs and telemetry.
func (Capability) Name() string { return "github" }

// Contribute injects GH_TOKEN + GITHUB_LOGIN when a token is present, or nil when
// there is none. GH_TOKEN is what `gh`/`git` authenticate with; GITHUB_LOGIN is
// the login the skills surface in their output. With a host set (WithHost) it is
// the enterprise-host set instead; spawn folds its NO_PROXY into the worker's.
func (c Capability) Contribute() []string {
	if c.token == "" {
		return nil
	}
	if c.host == "" || strings.EqualFold(c.host, "github.com") {
		return []string{
			"GH_TOKEN=" + c.token,
			"GITHUB_LOGIN=" + c.login,
		}
	}
	// Another host: gh reads it as an enterprise host (GH_HOST + GH_ENTERPRISE_TOKEN),
	// git rewrites github.com URLs to it, and the worker reaches it without the egress proxy.
	hostname, _, _ := strings.Cut(c.host, ":")
	return []string{
		"GH_HOST=" + c.host,
		"GH_ENTERPRISE_TOKEN=" + c.token,
		"GITHUB_LOGIN=" + c.login,
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=url.https://" + c.host + "/.insteadOf",
		"GIT_CONFIG_VALUE_0=https://github.com/",
		"NO_PROXY=" + hostname,
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
