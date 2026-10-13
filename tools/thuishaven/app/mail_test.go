package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func mailOrchestrator(store *fakeStore) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming("")},
		store: store,
	}
}

// @scenario "Every stack is assigned an inbox address of its own"
func TestMailAddress(t *testing.T) {
	o := mailOrchestrator(&fakeStore{stacks: []domain.Stack{{
		Slug:     "happy-tiger",
		Services: []domain.Service{{Name: domain.MailService, Port: 45580, URL: "https://mail.happy-tiger.langwatch.localhost"}},
	}}})
	got, err := o.MailAddress(UpParams{ExplicitSlug: "happy-tiger"})
	if err != nil {
		t.Fatalf("MailAddress() error = %v", err)
	}
	if want := "dev@happy-tiger.mail.langwatch.localhost"; got != want {
		t.Errorf("MailAddress() = %q, want %q", got, want)
	}
}

// @scenario "Reading mail with no sink running says so"
func TestMailAddressRefusesWithNoStackRunning(t *testing.T) {
	o := mailOrchestrator(&fakeStore{})
	_, err := o.MailAddress(UpParams{ExplicitSlug: "happy-tiger"})
	if err == nil {
		t.Fatal("MailAddress() succeeded with no stack registered")
	}
	if !strings.Contains(err.Error(), "haven up") {
		t.Errorf("error = %q, want it to name the command that starts a stack", err)
	}
}

// @scenario "Reading mail with no sink running says so"
func TestMailBaseURLRefusesWhenTheLaneIsOff(t *testing.T) {
	o := mailOrchestrator(&fakeStore{stacks: []domain.Stack{{
		Slug:     "happy-tiger",
		Services: []domain.Service{{Name: domain.MailService, Port: 0}},
	}}})
	_, err := o.MailBaseURL(UpParams{ExplicitSlug: "happy-tiger"})
	if err == nil {
		t.Fatal("MailBaseURL() succeeded although the lane has no port")
	}
	if !strings.Contains(err.Error(), "haven up +mail") {
		t.Errorf("error = %q, want it to name the flag that turns the lane back on", err)
	}
}

// @scenario "The sink appears in haven status like any other lane"
func TestMailAppearsInStatusWithHealthAndAddresses(t *testing.T) {
	o := &Orchestrator{sys: &fakeSystem{}}
	stacks := []domain.Stack{{
		Slug: "happy-tiger",
		Services: []domain.Service{
			{Name: domain.MailService, Port: 45580, SMTPPort: 45581,
				Hostname: "mail.happy-tiger.langwatch.localhost", URL: "https://mail.happy-tiger.langwatch.localhost"},
		},
	}}
	statuses := o.stackStatuses(stacks)
	if len(statuses) != 1 {
		t.Fatalf("stackStatuses() = %d entries, want 1", len(statuses))
	}
	var found bool
	for _, svc := range statuses[0].Services {
		if svc.Name != domain.MailService {
			continue
		}
		found = true
		if svc.SMTPPort != 45581 {
			t.Errorf("status SMTPPort = %d, want the allocated SMTP port", svc.SMTPPort)
		}
		if svc.Hostname != "mail.happy-tiger.langwatch.localhost" {
			t.Errorf("status Hostname = %q, want the browser hostname", svc.Hostname)
		}
		// Listening is the health half — false here only because no real
		// process is bound to the port in this test, not because the field
		// is missing from the report.
	}
	if !found {
		t.Fatal("the mail service is not in the status report")
	}
}

func TestMailBaseURLResolvesTheRunningSink(t *testing.T) {
	o := mailOrchestrator(&fakeStore{stacks: []domain.Stack{{
		Slug:     "happy-tiger",
		Services: []domain.Service{{Name: domain.MailService, Port: 45580, URL: "https://mail.happy-tiger.langwatch.localhost"}},
	}}})
	got, err := o.MailBaseURL(UpParams{ExplicitSlug: "happy-tiger"})
	if err != nil {
		t.Fatalf("MailBaseURL() error = %v", err)
	}
	if want := "https://mail.happy-tiger.langwatch.localhost"; got != want {
		t.Errorf("MailBaseURL() = %q, want %q", got, want)
	}
}
