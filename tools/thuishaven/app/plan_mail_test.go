package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func mailPlanChildren(t *testing.T, sel domain.Selection) []Child {
	t.Helper()
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), SimulatorArgv: []string{"/bin/haven", "simulator"}}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "test", Services: []domain.Service{
		{Name: domain.MailService, Port: 45580, SMTPPort: 45581, URL: "https://mail.test.langwatch.localhost"},
	}}
	return o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo, "")
}

// @scenario "The mail lane runs by default and can be turned off per worktree"
func TestMailLaneFollowsTheSelection(t *testing.T) {
	t.Run("given a selection that turned the mail lane off", func(t *testing.T) {
		sel := domain.DefaultSelection()
		sel.Mail = false
		if _, ok := findChild(mailPlanChildren(t, sel), "mail"); ok {
			t.Error("the mail sink lane was planned after being deselected")
		}
	})

	t.Run("given the default selection", func(t *testing.T) {
		mail, ok := findChild(mailPlanChildren(t, domain.DefaultSelection()), "mail")
		if !ok {
			t.Fatal("no mail lane was planned for a selection that asked for one")
		}
		if mail.Shell != "exec '/bin/haven' 'simulator' 'mail'" {
			t.Errorf("the mail lane runs %q, not Haven's bundled simulator", mail.Shell)
		}
		var hasHTTP, hasSMTP, hasData, hasBase bool
		for _, e := range mail.Env {
			switch e {
			case "MAILSIM_HTTP_ADDR=:45580":
				hasHTTP = true
			case "MAILSIM_SMTP_ADDR=:45581":
				hasSMTP = true
			case "MAILSIM_BASE_URL=https://mail.test.langwatch.localhost":
				hasBase = true
			}
			if strings.HasPrefix(e, "MAILSIM_DATA_DIR=") {
				hasData = true
			}
		}
		if !hasHTTP {
			t.Errorf("mail env %v lacks its allocated MAILSIM_HTTP_ADDR", mail.Env)
		}
		if !hasSMTP {
			t.Errorf("mail env %v lacks its allocated MAILSIM_SMTP_ADDR", mail.Env)
		}
		if !hasBase {
			t.Errorf("mail env %v lacks the routed MAILSIM_BASE_URL", mail.Env)
		}
		if !hasData {
			t.Error("mail env lacks MAILSIM_DATA_DIR — messages would not survive a restart")
		}
	})
}

// @scenario "A stack with the mail lane sends its email into the sink"
func TestMailSMTPEnvReachesBothNodeLanes(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "test", Services: []domain.Service{
		{Name: domain.MailService, Port: 45580, SMTPPort: 45581, URL: "https://mail.test.langwatch.localhost"},
	}}
	children := o.planChildren(st, PlanOptions{Selection: domain.DefaultSelection(), RepoRoot: repo}, repo, "")
	for _, name := range []string{"ui", APILane} {
		child, ok := findChild(children, name)
		if !ok {
			t.Fatalf("no %q lane was planned", name)
		}
		if !hasEnvLine(child.Env, "SMTP_PORT=45581") {
			t.Errorf("%s env lacks SMTP_PORT pointing at the sink: %v", name, child.Env)
		}
		if !hasEnvLine(child.Env, "EMAIL_PROVIDER=smtp") {
			t.Errorf("%s env lacks EMAIL_PROVIDER=smtp: %v", name, child.Env)
		}
	}
}

func hasEnvLine(env []string, line string) bool {
	for _, e := range env {
		if e == line {
			return true
		}
	}
	return false
}

// @scenario "Two worktrees' inboxes never mix"
func TestMailLaneIsIsolatedPerWorktree(t *testing.T) {
	plan := func(slug string, port, smtpPort int) Child {
		repo := t.TempDir()
		o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
		st := domain.Stack{Slug: slug, Services: []domain.Service{
			{Name: domain.MailService, Port: port, SMTPPort: smtpPort, URL: "https://mail." + slug + ".langwatch.localhost"},
		}}
		child, ok := findChild(o.planChildren(st, PlanOptions{Selection: domain.DefaultSelection(), RepoRoot: repo}, repo, ""), "mail")
		if !ok {
			t.Fatalf("no mail lane was planned for %q", slug)
		}
		return child
	}
	first := plan("happy-tiger", 45580, 45581)
	second := plan("quiet-fox", 45590, 45591)

	// Two different physical sink processes (distinct SMTP listeners) with two
	// distinct on-disk stores: nothing delivered to one worktree's listener can
	// land in the other's data, because the two never share either.
	if valueOf(first.Env, "MAILSIM_SMTP_ADDR") == valueOf(second.Env, "MAILSIM_SMTP_ADDR") {
		t.Fatal("two worktrees' mail lanes were planned onto the same SMTP listener")
	}
	if valueOf(first.Env, "MAILSIM_DATA_DIR") == valueOf(second.Env, "MAILSIM_DATA_DIR") {
		t.Fatal("two worktrees' mail lanes were planned onto the same data directory")
	}
}

func valueOf(env []string, key string) string {
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return strings.TrimPrefix(e, prefix)
		}
	}
	return ""
}

// @scenario "The inbox survives a stack restart"
func TestMailDataDirIsStableAcrossReplans(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "test", Services: []domain.Service{
		{Name: domain.MailService, Port: 45580, SMTPPort: 45581, URL: "https://mail.test.langwatch.localhost"},
	}}
	plan := func() string {
		child, ok := findChild(o.planChildren(st, PlanOptions{Selection: domain.DefaultSelection(), RepoRoot: repo}, repo, ""), "mail")
		if !ok {
			t.Fatal("no mail lane was planned")
		}
		return valueOf(child.Env, "MAILSIM_DATA_DIR")
	}
	// A restart re-plans the same stack from scratch; the data dir haven hands
	// the sink must be the same directory every time, or a restart would start
	// mailsim pointed at an empty new one.
	first := plan()
	second := plan()
	if first == "" || first != second {
		t.Errorf("MAILSIM_DATA_DIR = %q then %q, want the same stable directory across replans", first, second)
	}
}

func TestMailIsAPlannedHostname(t *testing.T) {
	var found bool
	for _, svc := range domain.PerWorktreeServices {
		if svc.Name == domain.MailService {
			found = true
		}
	}
	if !found {
		t.Fatal("mail is not in PerWorktreeServices, so provision would never route mail.<slug>")
	}
}
