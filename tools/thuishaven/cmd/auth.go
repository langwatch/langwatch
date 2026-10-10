package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The `haven auth` noun: haven signs in to this checkout's own stack through
// the app's normal email sign-in and writes a Playwright storage-state file
// (owner-only). The password never leaves haven, so an agent can hold a
// signed-in browser without ever seeing it.

const authHTTPTimeout = 60 * time.Second

func authSpec() commandSpec {
	return commandSpec{
		name:    "auth",
		summary: "sign in to this stack as admin or a seeded login's email and write a Playwright storage-state file (the password is never printed)",
		args:    "<admin|email>",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--out", takesValue: true, value: "<file>", summary: "where to write the storage state (default haven's per-stack browser dir)"},
			{long: "--json", summary: "machine-readable"},
			{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
		},
		run: runAuth,
	}
}

// authResult is what `haven auth` reports: never the password.
type authResult struct {
	Who   string `json:"who"`
	Email string `json:"email"`
	App   string `json:"app"`
	File  string `json:"file"`
}

func runAuth(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) != 1 {
		return errors.New("usage: haven auth <admin|email> [--out file] — member and viewer logins are listed by `haven seed --json`")
	}
	who := inv.args[0]
	overlay := telemetryOverlay(d, inv)
	appURL := telemetryOverlayValue(overlay, "LANGWATCH_ENDPOINT")
	if appURL == "" {
		return errors.New("this worktree has no running stack; run haven up --agent -d")
	}
	email, password, err := authCredentials(who, overlay)
	if err != nil {
		return err
	}
	out := inv.value("--out")
	if out == "" {
		slug, err := d.orch.ResolveSlug(authParams(d, inv))
		if err != nil {
			return err
		}
		out = filepath.Join(browserDir(slug), "auth", who+".json")
	}
	if err := signInToFile(ctx, appURL, email, password, out); err != nil {
		return err
	}
	res := authResult{Who: who, Email: email, App: appURL, File: out}
	if inv.has("--json") || d.isAgent {
		return json.NewEncoder(os.Stdout).Encode(res)
	}
	fmt.Printf("signed in to %s as %s; storage state in %s\n", appURL, email, out)
	return nil
}

func authParams(d deps, inv invocation) app.UpParams {
	p := d.params
	if slug := inv.value("--stack"); slug != "" {
		p.ExplicitSlug = slug
	}
	return p
}

// authCredentials is the login for who: the stack's admin, or a seeded login by
// email, which the seed gives the same dev password. A key the overlay lacks
// yielded to the developer's .env, as `haven seed` reads it.
func authCredentials(who string, overlay []string) (string, string, error) {
	value := func(key, fallback string) string {
		if v := telemetryOverlayValue(overlay, key); v != "" {
			return v
		}
		if v, ok := dotenvLookup(key); ok && v != "" {
			return v
		}
		return fallback
	}
	password := value("LANGWATCH_ADMIN_PASSWORD", domain.DefaultAdminPassword)
	switch {
	case who == "admin":
		return value("LANGWATCH_ADMIN_EMAIL", domain.DefaultAdminEmail), password, nil
	case strings.Contains(who, "@") && !strings.ContainsAny(who, `/\`):
		return who, password, nil
	}
	return "", "", fmt.Errorf("haven auth %q: name admin or a seeded login's email (`haven seed --json` lists them)", who)
}

// signInToFile signs in at app's email sign-in and writes the session cookies
// as a Playwright storage state, mode 600. It refuses any app that is not on
// this machine, so a dev password never travels anywhere else.
func signInToFile(ctx context.Context, appURL, email, password, out string) error {
	base, err := localApp(appURL)
	if err != nil {
		return err
	}
	cookies, err := signIn(ctx, base, email, password)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(storageState(base, cookies), "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o700); err != nil {
		return err
	}
	return atomicfile.Write(out, append(data, '\n'), 0o600)
}

// localApp parses app and refuses a host off this machine.
func localApp(appURL string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimRight(appURL, "/"))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("the stack's app URL %q does not parse", appURL)
	}
	host := u.Hostname()
	if host != "localhost" && host != "127.0.0.1" && !strings.HasSuffix(host, ".localhost") {
		return nil, fmt.Errorf("refusing to sign in to %s: haven auth only signs in to a local stack (*.localhost)", host)
	}
	return u, nil
}

func signIn(ctx context.Context, base *url.URL, email, password string) ([]*http.Cookie, error) {
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	origin := base.Scheme + "://" + base.Host
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/api/auth/sign-in/email", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", origin)
		resp, err := (&http.Client{Timeout: authHTTPTimeout}).Do(req)
		if err != nil {
			return nil, fmt.Errorf("could not reach %s: %w", origin, err)
		}
		reply, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		_ = resp.Body.Close()
		// The auth rate limiter names its own wait; take it once.
		if wait, ok := retryAfter(resp); ok && attempt == 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(wait):
				continue
			}
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			return nil, fmt.Errorf("sign-in as %s is rate-limited (the stack allows 30 per 15 minutes); saved lane sessions keep working", email)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("sign-in as %s answered %s: %s", email, resp.Status, strings.TrimSpace(string(reply)))
		}
		if len(resp.Cookies()) == 0 {
			return nil, fmt.Errorf("sign-in as %s set no session cookie", email)
		}
		return resp.Cookies(), nil
	}
}

func retryAfter(resp *http.Response) (time.Duration, bool) {
	if resp.StatusCode != http.StatusTooManyRequests {
		return 0, false
	}
	var secs int
	if _, err := fmt.Sscan(resp.Header.Get("Retry-After"), &secs); err != nil || secs <= 0 || secs > 60 {
		return 0, false
	}
	return time.Duration(secs) * time.Second, true
}

// playwrightCookie is one cookie in Playwright's storage-state shape.
type playwrightCookie struct {
	Name     string  `json:"name"`
	Value    string  `json:"value"`
	Domain   string  `json:"domain"`
	Path     string  `json:"path"`
	Expires  float64 `json:"expires"`
	HTTPOnly bool    `json:"httpOnly"`
	Secure   bool    `json:"secure"`
	SameSite string  `json:"sameSite"`
}

type playwrightState struct {
	Cookies []playwrightCookie `json:"cookies"`
	Origins []any              `json:"origins"`
}

func storageState(base *url.URL, cookies []*http.Cookie) playwrightState {
	state := playwrightState{Cookies: []playwrightCookie{}, Origins: []any{}}
	for _, c := range cookies {
		pc := playwrightCookie{Name: c.Name, Value: c.Value, Domain: c.Domain, Path: c.Path, Expires: -1, HTTPOnly: c.HttpOnly, Secure: c.Secure, SameSite: "Lax"}
		if pc.Domain == "" {
			pc.Domain = base.Hostname()
		}
		if pc.Path == "" {
			pc.Path = "/"
		}
		if !c.Expires.IsZero() {
			pc.Expires = float64(c.Expires.Unix())
		} else if c.MaxAge > 0 {
			pc.Expires = float64(time.Now().Add(time.Duration(c.MaxAge) * time.Second).Unix())
		}
		switch c.SameSite {
		case http.SameSiteStrictMode:
			pc.SameSite = "Strict"
		case http.SameSiteNoneMode:
			pc.SameSite = "None"
		}
		state.Cookies = append(state.Cookies, pc)
	}
	return state
}
