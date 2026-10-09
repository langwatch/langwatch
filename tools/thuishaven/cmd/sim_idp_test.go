package cmd

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

type idpSeen struct{ method, path, body string }

// recordIdP is a stub idpsim that answers `{}` and remembers the last request.
func recordIdP(t *testing.T) (sources.SimAPI, *idpSeen) {
	t.Helper()
	seen := &idpSeen{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		*seen = idpSeen{r.Method, r.URL.RequestURI(), string(raw)}
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	return sources.NewSimAPIAt(srv.URL), seen
}

// runIdPStub runs one verb against the stub the way runIdPVerb does.
func runIdPStub(t *testing.T, api sources.SimAPI, inv invocation) error {
	t.Helper()
	verb, words, rest, ok := findIdPVerb(inv.args)
	if !ok {
		t.Fatalf("no verb for %v", inv.args)
	}
	if len(rest) < verb.min {
		t.Fatalf("%s: %d arguments, verb wants %d", words, len(rest), verb.min)
	}
	return verb.run(idpCall{api: api, inv: inv, rest: rest, asJSON: true})
}

func TestIdPVerbsMatchTheLongestWords(t *testing.T) {
	for args, want := range map[string]string{
		"scim target set 1": "scim target set", "scim push 2": "scim push",
		"legacy provider 1 okta": "legacy provider", "populate 1": "populate",
	} {
		if _, words, _, ok := findIdPVerb(strings.Fields(args)); !ok || words != want {
			t.Errorf("%q matched %q, want %q", args, words, want)
		}
	}
	if _, _, _, ok := findIdPVerb([]string{"nonsense", "1"}); ok {
		t.Error("an unknown verb matched")
	}
}

func TestIdPPopulateSendsNumbersAndRefusesWithoutUsers(t *testing.T) {
	api, seen := recordIdP(t)
	inv := simInv("populate", "2")
	if err := runIdPStub(t, api, inv); err == nil {
		t.Fatal("populate without --users was accepted")
	}
	inv.flags["--users"], inv.flags["--groups"] = "5000", "12"
	if err := runIdPStub(t, api, inv); err != nil {
		t.Fatal(err)
	}
	if seen.path != "/control/t/2/population" || seen.body != `{"groups":12,"users":5000}` {
		t.Fatalf("sent %s %s", seen.path, seen.body)
	}
	inv = simInv("populate", "x")
	inv.flags["--users"] = "1"
	if err := runIdPStub(t, api, inv); err == nil {
		t.Fatal("a non-numeric tenant was accepted")
	}
}

func TestIdPDNSRemoveSendsNoValues(t *testing.T) {
	api, seen := recordIdP(t)
	if err := runIdPStub(t, api, simInv("dns", "remove", "acme1.test")); err != nil {
		t.Fatal(err)
	}
	if seen.method != "PUT" || seen.body != `{"domain":"acme1.test"}` {
		t.Fatalf("sent %s %s", seen.method, seen.body)
	}
}

func TestIdPSCIMEventReadsEveryRepeatedSet(t *testing.T) {
	api, seen := recordIdP(t)
	inv := simInv("scim-event", "1", "user.patch")
	inv.raw = []string{"scim-event", "1", "user.patch", "--set", "givenName=Ada", "--set=active=false", "--style", "entra"}
	inv.flags["--style"] = "entra"
	if err := runIdPStub(t, api, inv); err != nil {
		t.Fatal(err)
	}
	var body struct {
		Kind, Style string
		Set         map[string]any
	}
	if err := json.Unmarshal([]byte(seen.body), &body); err != nil {
		t.Fatal(err)
	}
	if body.Kind != "user.patch" || body.Style != "entra" || body.Set["givenName"] != "Ada" || body.Set["active"] != false {
		t.Fatalf("body = %s", seen.body)
	}
}

func TestIdPSyncMapsFlagsToTheQueryString(t *testing.T) {
	api, seen := recordIdP(t)
	inv := simInv("scim", "sync", "1")
	inv.flags["--dry-run"], inv.flags["--with-groups"], inv.flags["--mode"] = "", "", "delete"
	if err := runIdPStub(t, api, inv); err != nil {
		t.Fatal(err)
	}
	if seen.path != "/control/t/1/scim-sync?dryRun=1&groups=1&mode=delete" {
		t.Fatalf("path = %s", seen.path)
	}
}

func TestIdPAuth0WebhookTakesTheSecretFromTheEnvironmentOnly(t *testing.T) {
	api, seen := recordIdP(t)
	for _, f := range idpFlags {
		if f.long == "--secret" || f.long == "--token" {
			t.Fatalf("%s would put a secret on the command line", f.long)
		}
	}
	inv := simInv("auth0-webhook", "1")
	inv.flags["--target"], inv.flags["--event"], inv.flags["--user"] = "https://app.x.test", "create", "ada@acme1.test"
	inv.flags["--secret-env"] = "IDP_TEST_WEBHOOK_SECRET"
	t.Setenv("IDP_TEST_WEBHOOK_SECRET", "")
	if err := runIdPStub(t, api, inv); err == nil || strings.Contains(err.Error(), "hunter2") {
		t.Fatalf("an unset secret variable gave %v", err)
	}
	t.Setenv("IDP_TEST_WEBHOOK_SECRET", "hunter2")
	if err := runIdPStub(t, api, inv); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(seen.body, `"secret":"hunter2"`) || !strings.Contains(seen.body, `"event":"create"`) {
		t.Fatalf("body = %s", seen.body)
	}
}

func TestIdPSignInPrintsOnlyTheNamedUser(t *testing.T) {
	reply := signInReply{Users: []struct{ Name, Email, Href string }{{"Ada", "ada@x.test", "/t/1/a"}, {"Bob", "bob@x.test", "/t/1/b"}}}
	got := captureStdout(t, func() { printSignIn(reply, "https://idp.x", "BOB@x.test") })
	if !strings.Contains(got, "https://idp.x/t/1/b") || strings.Contains(got, "/t/1/a") {
		t.Fatalf("printed %q", got)
	}
}

// @scenario "haven idp verification sets and clears the well-known verification file"
func TestIdPVerificationSetsAndClearsTheWellKnownToken(t *testing.T) {
	api, seen := recordIdP(t)
	if err := runIdPStub(t, api, simInv("verification", "set", "acme1.test", "tok-1")); err != nil {
		t.Fatal(err)
	}
	if seen.method != "PUT" || seen.path != "/control/verification" || seen.body != `{"domain":"acme1.test","token":"tok-1"}` {
		t.Fatalf("set sent %s %s %s", seen.method, seen.path, seen.body)
	}
	if err := runIdPStub(t, api, simInv("verification", "clear", "acme1.test")); err != nil {
		t.Fatal(err)
	}
	if seen.method != "PUT" || seen.body != `{"domain":"acme1.test"}` {
		t.Fatalf("clear sent %s %s", seen.method, seen.body)
	}
}
