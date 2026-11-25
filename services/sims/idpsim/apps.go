package idpsim

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Application is one relying party registered with a tenant — the record a
// real IdP makes you create before it will talk to your app. Registering one
// is what turns idpsim from "accepts anything" into "accepts exactly this",
// which is how a misconfigured issuer, client id or redirect address becomes a
// visible refusal instead of a login that mysteriously works.
type Application struct {
	// ClientID and Secret are what the relying party authenticates with. They
	// are handed back once, on the registration page, in the same words the
	// LangWatch wizard asks for them.
	ClientID string `json:"clientId"`
	Secret   string `json:"clientSecret"`
	Name     string `json:"name"`
	// RedirectURIs are the addresses this client may be sent back to. A
	// {placeholder} path segment matches any single segment — see
	// redirectAllowed.
	RedirectURIs []string `json:"redirectUris"`
	// EntityID and ACSURL are the SAML half, recorded when the relying party
	// connects over SAML instead of OIDC. Both are optional.
	EntityID  string    `json:"entityId,omitempty"`
	ACSURL    string    `json:"acsUrl,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Applications returns a snapshot of the tenant's registered applications.
func (t *Tenant) Applications() []*Application {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]*Application, len(t.apps))
	copy(out, t.apps)
	return out
}

// ApplicationByClientID finds a registered application by its client id.
func (t *Tenant) ApplicationByClientID(clientID string) (*Application, bool) {
	if clientID == "" {
		return nil, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, a := range t.apps {
		if a.ClientID == clientID {
			return a, true
		}
	}
	return nil, false
}

// Registration is what a relying party tells the tenant about itself. The
// credentials are the tenant's answer, not part of the question.
type Registration struct {
	Name         string
	RedirectURIs []string
	EntityID     string
	ACSURL       string
}

// RegisterApplication mints credentials for a new relying party and stores it.
func (t *Tenant) RegisterApplication(reg Registration, now time.Time) *Application {
	app := &Application{
		ClientID:     fmt.Sprintf("idpsim-t%d-%s", t.ID, randomToken()[:8]),
		Secret:       randomToken() + randomToken(),
		Name:         reg.Name,
		RedirectURIs: reg.RedirectURIs,
		EntityID:     reg.EntityID,
		ACSURL:       reg.ACSURL,
		CreatedAt:    now,
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.apps = append(t.apps, app)
	return app
}

// RemoveApplication deletes a registration, reporting whether it existed.
func (t *Tenant) RemoveApplication(clientID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i, a := range t.apps {
		if a.ClientID == clientID {
			t.apps = append(t.apps[:i], t.apps[i+1:]...)
			return true
		}
	}
	return false
}

// redirectAllowed reports whether the address the client asked to be sent back
// to is one this application registered.
//
// A path segment written as {placeholder} matches any single segment. That
// exists for one specific reason: LangWatch's SSO setup screen shows the
// redirect address before the connection exists, as
// …/api/auth/sso/callback/{connection}, and only fills in the real id once you
// have registered the connection — which you cannot do until the identity
// provider is set up. Registering the address exactly as the screen shows it
// breaks that circle: the pattern matches whichever connection id turns up.
func (a *Application) redirectAllowed(candidate string) bool {
	for _, pattern := range a.RedirectURIs {
		if redirectMatches(pattern, candidate) {
			return true
		}
	}
	return false
}

func redirectMatches(pattern, candidate string) bool {
	if pattern == candidate {
		return true
	}
	p, err := url.Parse(pattern)
	if err != nil {
		return false
	}
	c, err := url.Parse(candidate)
	if err != nil {
		return false
	}
	if !strings.EqualFold(p.Scheme, c.Scheme) || !strings.EqualFold(p.Host, c.Host) {
		return false
	}
	return pathMatches(p.Path, c.Path)
}

// pathMatches compares two paths segment by segment, treating a whole
// {placeholder} segment in the pattern as a wildcard for exactly one segment.
func pathMatches(pattern, candidate string) bool {
	patternSegs, candidateSegs := strings.Split(pattern, "/"), strings.Split(candidate, "/")
	if len(patternSegs) != len(candidateSegs) {
		return false
	}
	for i, seg := range patternSegs {
		if isPlaceholder(seg) {
			// A placeholder stands for a real segment, so an empty one (a
			// trailing slash, a doubled separator) must not satisfy it.
			if candidateSegs[i] == "" {
				return false
			}
			continue
		}
		if seg != candidateSegs[i] {
			return false
		}
	}
	return true
}

// isPlaceholder reports whether a path segment is a whole {placeholder}.
func isPlaceholder(segment string) bool {
	return len(segment) > 2 && strings.HasPrefix(segment, "{") && strings.HasSuffix(segment, "}")
}

// splitLines turns a textarea's worth of addresses into a clean list.
func splitLines(raw string) []string {
	var out []string
	for _, line := range strings.FieldsFunc(raw, func(r rune) bool { return r == '\n' || r == '\r' || r == ',' }) {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
