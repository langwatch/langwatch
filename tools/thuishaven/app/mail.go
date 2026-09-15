// The `haven mail` noun's orchestrator half: resolving which stack's mail
// sink a command means, and refusing fast — naming the lane and the command
// that starts it — when that lane is not actually running. The CLI (cmd/mail.go)
// does the HTTP calls against the sink's own API; this file only answers
// "where is it" (or "it isn't").
package app

import (
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// mailService resolves this worktree's registered mail sink, or the exact
// refusal `haven mail` prints when it is not there: no stack running here at
// all, or a stack running with the lane turned off. Either way the caller
// fails immediately, before attempting a single HTTP call — a dead address
// must never look like a hang.
func (o *Orchestrator) mailService(p UpParams) (domain.Service, string, error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return domain.Service{}, "", err
	}
	st, ok := o.stackBySlug(slug)
	if !ok {
		return domain.Service{}, "", fmt.Errorf("no stack is running for %q — start it with `haven up`", slug)
	}
	for _, svc := range st.Services {
		if svc.Name == domain.MailService && svc.Port != 0 {
			return svc, slug, nil
		}
	}
	return domain.Service{}, "", fmt.Errorf(
		"the mail lane is not running for %q — it runs by default; bring it up with `haven up +mail`", slug)
}

// MailAddress is this worktree's own inbox address: any local part at the
// mail domain lands in the same catch-all inbox, so a script may address
// user1@, admin+alias@ or anything else without registering it first.
func (o *Orchestrator) MailAddress(p UpParams) (string, error) {
	_, slug, err := o.mailService(p)
	if err != nil {
		return "", err
	}
	return "dev@" + o.cfg.Naming.MailAddressDomain(slug), nil
}

// MailBaseURL is the sink's own HTTP base URL for this worktree's stack —
// what every `haven mail` subcommand besides `address` dials.
func (o *Orchestrator) MailBaseURL(p UpParams) (string, error) {
	svc, slug, err := o.mailService(p)
	if err != nil {
		return "", err
	}
	if svc.URL == "" {
		return "", fmt.Errorf("the mail lane for %q has no URL yet — try `haven up` again", slug)
	}
	return svc.URL, nil
}
