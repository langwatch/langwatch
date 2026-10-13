package cmd

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSignInWritesAnOwnerOnlyStorageState(t *testing.T) {
	var origin, body string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/auth/sign-in/email" {
			t.Errorf("signed in at %s", r.URL.Path)
		}
		origin = r.Header.Get("Origin")
		raw := make([]byte, 256)
		n, _ := r.Body.Read(raw)
		body = string(raw[:n])
		http.SetCookie(w, &http.Cookie{Name: "better-auth.session_token", Value: "tok", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
	}))
	defer srv.Close()
	out := filepath.Join(t.TempDir(), "auth", "admin.json")
	if err := signInToFile(context.Background(), srv.URL, "a@b.localhost", "pw", out); err != nil {
		t.Fatal(err)
	}
	if origin != srv.URL || !strings.Contains(body, `"password":"pw"`) {
		t.Errorf("origin %q body %q", origin, body)
	}
	info, err := os.Stat(out)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("storage state mode %v (%v), want 600", info.Mode().Perm(), err)
	}
	var state playwrightState
	data, _ := os.ReadFile(out)
	if err := json.Unmarshal(data, &state); err != nil || len(state.Cookies) != 1 {
		t.Fatalf("state %s", data)
	}
	if c := state.Cookies[0]; c.Domain != "127.0.0.1" || c.SameSite != "Strict" || !c.HTTPOnly || c.Expires != -1 || c.Value != "tok" {
		t.Errorf("cookie %+v", c)
	}
	if strings.Contains(string(data), "pw") {
		t.Error("the storage state carries the password")
	}
}

func TestSignInRefusesAStackOffThisMachine(t *testing.T) {
	err := signInToFile(context.Background(), "https://app.example.com", "a@b", "pw", filepath.Join(t.TempDir(), "x.json"))
	if err == nil || !strings.Contains(err.Error(), "only signs in to a local stack") {
		t.Fatalf("err = %v", err)
	}
}

func TestSignInReportsAFailedLoginWithoutThePassword(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	err := signInToFile(context.Background(), srv.URL, "a@b.localhost", "secret-pw", filepath.Join(t.TempDir(), "x.json"))
	if err == nil || strings.Contains(err.Error(), "secret-pw") || !strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v", err)
	}
}

func TestAuthCredentialsNamesAdminOrASeededEmail(t *testing.T) {
	overlay := []string{"LANGWATCH_ADMIN_EMAIL=admin@x.localhost", "LANGWATCH_ADMIN_PASSWORD=pw"}
	if email, pw, err := authCredentials("admin", overlay); err != nil || email != "admin@x.localhost" || pw != "pw" {
		t.Errorf("admin = %q %q %v", email, pw, err)
	}
	if email, pw, err := authCredentials("dev@seed.test", overlay); err != nil || email != "dev@seed.test" || pw != "pw" {
		t.Errorf("seeded = %q %q %v", email, pw, err)
	}
	for _, who := range []string{"member", "../@x"} {
		if _, _, err := authCredentials(who, overlay); err == nil {
			t.Errorf("authCredentials(%q) accepted", who)
		}
	}
}

func TestBrowserRequestNeedsALane(t *testing.T) {
	inv, err := parse(browserSpec(), []string{"open", "/settings"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := browserRequest("open", inv); err == nil {
		t.Error("open without --lane was accepted")
	}
	inv, _ = parse(browserSpec(), []string{"eval", "--lane", "a"})
	if _, err := browserRequest("eval", inv); err == nil {
		t.Error("eval without an expression was accepted")
	}
	inv, _ = parse(browserSpec(), []string{"open", "/settings", "--lane", "a", "--as", "admin", "--timeout", "5s"})
	req, err := browserRequest("open", inv)
	if err != nil || req["url"] != "/settings" || req["as"] != "admin" || req["timeoutMs"] != int64(5000) {
		t.Errorf("req = %v (%v)", req, err)
	}
}

func TestBrowserSelectTakesATargetAndAnOption(t *testing.T) {
	inv, _ := parse(browserSpec(), []string{"select", "#plan", "Team", "--lane", "a"})
	req, err := browserRequest("select", inv)
	if err != nil || req["ref"] != "#plan" || req["text"] != "Team" {
		t.Errorf("req = %v (%v)", req, err)
	}
	inv, _ = parse(browserSpec(), []string{"select", "#plan", "--lane", "a"})
	if _, err := browserRequest("select", inv); err == nil {
		t.Error("select without an option was accepted")
	}
}
