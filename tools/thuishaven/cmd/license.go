package cmd

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// `haven login`, `haven logout` and `haven license` (ADR-180): sign haven in to LangWatch
// Cloud once, then ask for a stack's testing license only when told to. The token and the
// device code are held 0600 and never printed.

func loginSpec() commandSpec {
	return commandSpec{
		name:    "login",
		summary: "sign haven in to LangWatch Cloud once, in the browser, so it can ask for testing licenses; `login status` says whether it is signed in",
		args:    "[status]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--no-open", summary: "print the sign-in URL and code without opening a browser"},
			{long: "--wait", summary: "resume the sign-in `haven login --agent` started and wait for its approval"},
			{long: "--json", summary: "machine-readable"},
		},
		run: runLogin,
	}
}

func logoutSpec() commandSpec {
	return commandSpec{
		name:    "logout",
		summary: "revoke haven's LangWatch Cloud token on Cloud, then forget it on this machine",
		run:     runLogout,
	}
}

func licenseSpec() commandSpec {
	return commandSpec{
		name:    "license",
		summary: "ask LangWatch Cloud for this stack's testing license, or renew it before it ends; needs `haven login` or a service token in LANGWATCH_TESTING_LICENSE_TOKEN",
		args:    "[renew|status]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--duration", takesValue: true, value: "<dur>", summary: "how long it lasts, e.g. 36h or 5d (default 5d, at most 30d)"},
			{long: "--json", summary: "status: machine-readable"},
		},
		run: runLicense,
	}
}

// cloudSignIn is the sign-in flow with every effect a field, so a test stands in for each.
type cloudSignIn struct {
	state    cloudState
	out      io.Writer
	now      func() time.Time
	open     func(string) error
	getenv   func(string) string
	newCloud func(string) (cloudClient, error)
}

func newCloudSignIn() cloudSignIn {
	return cloudSignIn{
		state: havenCloudState(), out: os.Stdout, now: time.Now,
		open: openInBrowser, getenv: os.Getenv, newCloud: newCloudClient,
	}
}

type signInOptions struct{ agent, noOpen, wait bool }

func runLogin(ctx context.Context, d deps, inv invocation) error {
	flow := newCloudSignIn()
	if len(inv.args) > 0 {
		if inv.args[0] != "status" {
			return usageErr("haven login: unknown subcommand %q; status is the only one", inv.args[0])
		}
		return flow.status(inv.has("--json") || d.isAgent)
	}
	return flow.run(ctx, signInOptions{agent: d.isAgent, noOpen: inv.has("--no-open"), wait: inv.has("--wait")})
}

func (s cloudSignIn) run(ctx context.Context, opts signInOptions) error {
	if opts.wait {
		return s.resume(ctx)
	}
	if token, err := s.state.token(s.getenv, s.now()); err == nil && token.Source == "login" {
		_, _ = fmt.Fprintf(s.out, "already signed in to %s%s; `haven logout` first to switch\n", token.CloudURL, untilText(token.ExpiresAt))
		return nil
	}
	cloud, err := s.newCloud(strings.TrimSpace(s.getenv(cloudURLKnob)))
	if err != nil {
		return err
	}
	pending, err := cloud.startLogin(ctx)
	if err != nil {
		return err
	}
	if err := s.state.write(s.state.pendingPath(), pending); err != nil {
		return err
	}
	if opts.agent {
		return json.NewEncoder(s.out).Encode(map[string]any{
			"verificationUrl": pending.VerificationURL,
			"userCode":        pending.UserCode,
			"expiresAt":       pending.ExpiresAt.Format(time.RFC3339),
			"next":            "haven login --wait",
		})
	}
	_, _ = fmt.Fprintf(s.out, "Open %s to sign haven in to LangWatch Cloud.\nThe page shows the code %s; approve it there.\n", pending.VerificationURL, pending.UserCode)
	if !opts.noOpen {
		if err := s.open(pending.VerificationURL); err != nil {
			_, _ = fmt.Fprintln(s.out, "haven could not open a browser; open the URL yourself")
		}
	}
	return s.await(ctx, cloud, pending)
}

// resume waits on the sign-in a `haven login --agent` left in the state directory.
func (s cloudSignIn) resume(ctx context.Context) error {
	var pending pendingLogin
	found, err := s.state.read(s.state.pendingPath(), &pending)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("no sign-in is waiting; `haven login --agent` starts one")
	}
	if s.now().After(pending.ExpiresAt) {
		_ = s.state.remove(s.state.pendingPath())
		return errors.New("the waiting sign-in expired; `haven login --agent` starts a new one")
	}
	cloud, err := s.newCloud(pending.CloudURL)
	if err != nil {
		return err
	}
	return s.await(ctx, cloud, pending)
}

func (s cloudSignIn) await(ctx context.Context, cloud cloudClient, pending pendingLogin) error {
	login, err := cloud.awaitLogin(ctx, pending)
	if err != nil {
		if ctx.Err() == nil {
			_ = s.state.remove(s.state.pendingPath())
		}
		return err
	}
	if err := s.state.write(s.state.loginPath(), login); err != nil {
		return err
	}
	_ = s.state.remove(s.state.pendingPath())
	_, _ = fmt.Fprintf(s.out, "signed in to %s%s\n", login.CloudURL, untilText(login.ExpiresAt))
	return nil
}

func untilText(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return " until " + t.Format(time.RFC3339)
}

// signInStatus is what `haven login status` says; no token or device code is in it.
type signInStatus struct {
	SignedIn  bool   `json:"signedIn"`
	Source    string `json:"source"`
	Cloud     string `json:"cloud,omitempty"`
	ExpiresAt string `json:"expiresAt,omitempty"`
	Pending   bool   `json:"pending"`
	Reason    string `json:"reason,omitempty"`
}

func (s cloudSignIn) status(asJSON bool) error {
	view := signInStatus{Source: "none"}
	token, err := s.state.token(s.getenv, s.now())
	switch {
	case err == nil:
		view.SignedIn, view.Source, view.Cloud = true, token.Source, token.CloudURL
		if !token.ExpiresAt.IsZero() {
			view.ExpiresAt = token.ExpiresAt.Format(time.RFC3339)
		}
	default:
		view.Reason = err.Error()
	}
	var pending pendingLogin
	if found, _ := s.state.read(s.state.pendingPath(), &pending); found && s.now().Before(pending.ExpiresAt) {
		view.Pending = true
	}
	if asJSON {
		return json.NewEncoder(s.out).Encode(view)
	}
	switch {
	case view.Source == "env":
		_, _ = fmt.Fprintf(s.out, "using %s for %s: a service token, no sign-in needed\n", testingLicenseTokenKnob, view.Cloud)
	case view.SignedIn:
		_, _ = fmt.Fprintf(s.out, "signed in to %s%s\n", view.Cloud, untilText(token.ExpiresAt))
	default:
		_, _ = fmt.Fprintf(s.out, "not signed in (%s): run `haven login`\n", view.Reason)
	}
	if view.Pending {
		_, _ = fmt.Fprintln(s.out, "a sign-in is waiting for approval: `haven login --wait` resumes it")
	}
	return nil
}

func runLogout(ctx context.Context, _ deps, _ invocation) error {
	return newCloudSignIn().logout(ctx)
}

// logout revokes the stored token on Cloud, then forgets it here even when Cloud cannot be
// reached, saying so. A service token in LANGWATCH_TESTING_LICENSE_TOKEN is never touched.
func (s cloudSignIn) logout(ctx context.Context) error {
	var login cloudLogin
	found, err := s.state.read(s.state.loginPath(), &login)
	if err != nil {
		return err
	}
	revokeErr := errNotSignedIn
	if found && login.Token != "" {
		revokeErr = s.revokeOnCloud(ctx, login)
	}
	for _, path := range []string{s.state.loginPath(), s.state.pendingPath()} {
		if err := s.state.remove(path); err != nil {
			return err
		}
	}
	switch {
	case !found || login.Token == "":
		_, _ = fmt.Fprintln(s.out, "haven was not signed in to LangWatch Cloud on this machine")
	case revokeErr == nil:
		_, _ = fmt.Fprintf(s.out, "signed out: the token is revoked on %s and forgotten on this machine\n", login.CloudURL)
	default:
		_, _ = fmt.Fprintf(s.out, "signed out on this machine only: haven could not revoke the token on %s (%v); an ops manager can revoke it in the ops console\n", login.CloudURL, revokeErr)
	}
	return nil
}

func (s cloudSignIn) revokeOnCloud(ctx context.Context, login cloudLogin) error {
	cloud, err := s.newCloud(login.CloudURL)
	if err != nil {
		return err
	}
	return cloud.revoke(ctx, login.Token)
}

func runLicense(ctx context.Context, d deps, inv invocation) error {
	sub := ""
	if len(inv.args) > 0 {
		sub = inv.args[0]
	}
	if sub != "" && sub != "renew" && sub != "status" {
		return usageErr("haven license: unknown subcommand %q; renew or status", sub)
	}
	if sub == "status" {
		return runLicenseStatus(d, inv)
	}
	lifetime, err := parseLifetime(inv.value("--duration"))
	if err != nil {
		return usageErr("haven license: --duration %v", err)
	}
	licenser, err := stackLicenser(d, inv, os.Stdout)
	if err != nil {
		return err
	}
	licenser.window = 30 * time.Second
	if sub == "renew" {
		err = licenser.renew(ctx)
	} else {
		err = licenser.ask(ctx, lifetime)
	}
	if errors.Is(err, errNotSignedIn) {
		return errors.New(licenseSignInHint(err))
	}
	return err
}

// licenseView is what `haven license status` says of the license haven stored in a stack.
type licenseView struct {
	Stack     string `json:"stack"`
	Held      bool   `json:"held"`
	ExpiresAt string `json:"expiresAt,omitempty"`
	SignedIn  bool   `json:"signedIn"`
}

func runLicenseStatus(d deps, inv invocation) error {
	slug := d.resolvedStack()
	if slug == "" {
		return usageErr("haven license status: no stack here; pass --stack <slug>")
	}
	state := havenCloudState()
	held, ok, err := state.held(slug)
	if err != nil {
		return err
	}
	view := licenseView{Stack: slug, Held: ok}
	if ok {
		view.ExpiresAt = held.ExpiresAt.Format(time.RFC3339)
	}
	_, tokenErr := state.token(os.Getenv, time.Now())
	view.SignedIn = tokenErr == nil
	if inv.has("--json") || d.isAgent {
		return json.NewEncoder(os.Stdout).Encode(view)
	}
	if ok {
		fmt.Printf("%s holds a testing license haven issued, until %s\n", slug, view.ExpiresAt)
	} else {
		fmt.Printf("haven has issued no testing license for %s; `haven license` asks for one\n", slug)
	}
	if !view.SignedIn {
		fmt.Println("haven is not signed in to Cloud, so it cannot ask or renew: run `haven login`")
	}
	return nil
}

// stackLicenser aims a licenser at this stack's app with the seeded admin's login.
func stackLicenser(d deps, inv invocation, out io.Writer) (testingLicenser, error) {
	overlay := telemetryOverlay(d, inv)
	app := telemetryOverlayValue(overlay, "LANGWATCH_ENDPOINT")
	if app == "" {
		return testingLicenser{}, errors.New("this worktree has no running stack; run haven up --agent -d")
	}
	email, password, err := authCredentials("admin", overlay)
	if err != nil {
		return testingLicenser{}, err
	}
	slug, err := d.orch.ResolveSlug(authParams(d, inv))
	if err != nil {
		return testingLicenser{}, err
	}
	return newTestingLicenser(licenseStack{Slug: slug, App: app, Email: email, Password: password}, out, os.Getenv), nil
}

// licenseAskedAtUp refuses a bad --testing-license value and, before anything starts, says
// when haven is not signed in. The stack starts on the open-source plan either way.
func licenseAskedAtUp(inv invocation) error {
	if !inv.has("--testing-license") {
		return nil
	}
	if _, err := parseLifetime(inv.value("--testing-license")); err != nil {
		return usageErr("haven up: --testing-license %v", err)
	}
	if _, err := havenCloudState().token(os.Getenv, time.Now()); err != nil {
		fmt.Fprintln(os.Stderr, "haven: "+licenseSignInHint(err))
	}
	return nil
}

// testingLicenseAfterUp asks for the stack's testing license once it answers, when
// --testing-license told it to, or renews the one haven issued when it nears its end.
// The stack never waits on it, and a stack with neither contacts nobody. The returned
// function waits for the step to finish.
func testingLicenseAfterUp(ctx context.Context, d deps, inv invocation) (wait func()) {
	noop := func() {}
	slug := d.resolvedStack()
	asked := inv.has("--testing-license")
	_, held, _ := havenCloudState().held(slug)
	if slug == "" || (!asked && !held) {
		return noop
	}
	if _, err := parseLifetime(inv.value("--testing-license")); err != nil {
		return noop
	}
	if _, tokenErr := havenCloudState().token(os.Getenv, time.Now()); asked && tokenErr != nil {
		return noop // `up` already said to sign in
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		runTestingLicense(ctx, d, inv)
	}()
	return func() { <-done }
}

// runTestingLicense waits for the stack, then asks for a license (when --testing-license
// said so) or renews the held one, saying why when it cannot.
func runTestingLicense(ctx context.Context, d deps, inv invocation) {
	if !waitStackReady(ctx, d, d.resolvedStack()) {
		fmt.Println("haven: testing license: the stack did not answer in time; `haven license` asks again once it does")
		return
	}
	licenser, err := stackLicenser(d, inv, os.Stdout)
	if err == nil && inv.has("--testing-license") {
		lifetime, _ := parseLifetime(inv.value("--testing-license"))
		err = licenser.ask(ctx, lifetime)
	} else if err == nil {
		err = licenser.renew(ctx)
	}
	if err != nil && ctx.Err() == nil {
		fmt.Println("haven: " + licenseSignInHint(err))
	}
}

// stackReadyTimeout is how long the testing license step waits for the stack to answer.
const stackReadyTimeout = 5 * time.Minute

// waitStackReady polls the stack's cheap snapshot until every one of its own services answers.
func waitStackReady(ctx context.Context, d deps, slug string) bool {
	deadline := time.Now().Add(stackReadyTimeout)
	for {
		if reached(d.orch.SessionSnapshot(slug), "ready") {
			return true
		}
		if time.Now().After(deadline) || sleepContext(ctx, time.Second) != nil {
			return false
		}
	}
}
