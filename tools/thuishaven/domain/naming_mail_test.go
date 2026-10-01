package domain

import "testing"

// @scenario "Every stack is assigned an inbox address of its own"
func TestMailAddressDomainLeadsWithTheSlug(t *testing.T) {
	n := DefaultNaming("localhost")
	if got := n.MailAddressDomain("happy-tiger"); got != "happy-tiger.mail.langwatch.localhost" {
		t.Errorf("MailAddressDomain(%q) = %q, want <slug>.mail.langwatch.localhost", "happy-tiger", got)
	}
}

// Not the full isolation scenario ("Two worktrees' inboxes never mix") — that
// needs the actual sink process, which is another lane's — only the naming
// half haven owns: two worktrees never derive the same address.
func TestMailAddressDomainIsSlugSpecific(t *testing.T) {
	n := DefaultNaming("localhost")
	if n.MailAddressDomain("happy-tiger") == n.MailAddressDomain("quiet-fox") {
		t.Fatal("two different slugs produced the same mail address domain")
	}
}

func TestMailIsAPlannedHostname(t *testing.T) {
	var found bool
	for _, svc := range PerWorktreeServices {
		if svc.Name == MailService {
			found = true
		}
	}
	if !found {
		t.Fatal("mail is not in PerWorktreeServices, so provision would never route mail.<slug>")
	}
	n := DefaultNaming("localhost")
	if got := n.Hostname(MailService, "happy-tiger"); got != "mail.happy-tiger.langwatch.localhost" {
		t.Errorf("mail sink hostname = %q, want mail.<slug>", got)
	}
}
