// Package accesse2e runs the image against a real ClickHouse (ADR-184). It
// needs Docker on Linux and runs only when CH_ACCESS_E2E_IMAGE names an image:
// `make e2e-access` builds one and sets it, CI's docker e2e job runs that.
package accesse2e

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const container = "ch-e2e-access"

type harness struct {
	t        *testing.T
	secrets  string
	issuer   *httptest.Server
	key      *ecdsa.PrivateKey
	password string
}

// @scenario "A real ClickHouse honours tiers, rolling passwords and token logins"
func TestAccessAgainstRealClickHouse(t *testing.T) {
	image := os.Getenv("CH_ACCESS_E2E_IMAGE")
	if image == "" {
		t.Skip("CH_ACCESS_E2E_IMAGE not set; run `make e2e-access` (needs Docker)")
	}
	h := start(t, image)

	h.admin("CREATE DATABASE IF NOT EXISTS analytics")
	h.admin("CREATE TABLE analytics.events (x UInt8) ENGINE = MergeTree ORDER BY x")
	h.admin("INSERT INTO analytics.events VALUES (1), (2)")
	h.admin("SYSTEM FLUSH LOGS")

	t.Run("both rolling passwords log in over HTTP and native", func(t *testing.T) {
		for _, pw := range []string{"first-password-0123456789", "second-password-0123456789"} {
			if out, err := h.query("metabase", pw, "SELECT count() FROM analytics.events"); err != nil || out != "2" {
				t.Errorf("HTTP with %s...: %q, %v", pw[:6], out, err)
			}
			if out, err := h.native("metabase", pw, "SELECT count() FROM analytics.events"); err != nil || out != "2" {
				t.Errorf("native with %s...: %q, %v", pw[:6], out, err)
			}
		}
	})

	t.Run("the read tier cannot write or read query text", func(t *testing.T) {
		pw := "second-password-0123456789"
		if _, err := h.query("metabase", pw, "INSERT INTO analytics.events VALUES (3)"); err == nil {
			t.Error("a read user inserted a row")
		}
		_, err := h.query("metabase", pw, "SELECT count() FROM system.query_log")
		if err == nil || !strings.Contains(err.Error(), "ACCESS_DENIED") {
			t.Errorf("a read user reached system.query_log: %v", err)
		}
		if _, err := h.query("metabase", pw, "SELECT max_execution_time FROM system.settings SETTINGS max_execution_time = 100000"); err == nil {
			t.Error("a read user raised max_execution_time past its cap")
		}
	})

	t.Run("a removed password stops working, the other keeps working", func(t *testing.T) {
		if err := os.Remove(filepath.Join(h.secrets, "first")); err != nil {
			t.Fatal(err)
		}
		h.eventually(func() bool {
			_, err := h.query("metabase", "first-password-0123456789", "SELECT 1")
			return err != nil
		}, "the removed password still logs in")
		if _, err := h.query("metabase", "second-password-0123456789", "SELECT 1"); err != nil {
			t.Errorf("the remaining password stopped working: %v", err)
		}
	})

	t.Run("a password past its valid_until stops working", func(t *testing.T) {
		until := time.Now().Add(25 * time.Second).UTC().Format(time.RFC3339)
		h.writeSecret("third", "third-password-0123456789")
		h.writeSecret("third.valid_until", until)
		h.eventually(func() bool {
			_, err := h.query("metabase", "third-password-0123456789", "SELECT 1")
			return err == nil
		}, "the added password never logged in")
		h.eventually(func() bool {
			_, err := h.query("metabase", "third-password-0123456789", "SELECT 1")
			return err != nil
		}, "the expired password still logs in")
	})

	t.Run("a fresh token logs in over HTTP and native, others are refused", func(t *testing.T) {
		token := h.token("alice@example.com", time.Now().Add(10*time.Minute))
		if len(token) < 500 {
			t.Fatalf("token of %d bytes is not representative", len(token))
		}
		if out, err := h.query("alice", token, "SELECT count() FROM analytics.events"); err != nil || out != "2" {
			t.Errorf("token over HTTP: %q, %v", out, err)
		}
		if out, err := h.native("alice", token, "SELECT count() FROM analytics.events"); err != nil || out != "2" {
			t.Errorf("token over native: %q, %v", out, err)
		}
		if _, err := h.query("alice", h.token("alice@example.com", time.Now().Add(-time.Minute)), "SELECT 1"); err == nil {
			t.Error("an expired token logged in")
		}
		if _, err := h.query("alice", h.token("mallory@example.com", time.Now().Add(10*time.Minute)), "SELECT 1"); err == nil {
			t.Error("a token for another subject logged in")
		}
	})
}

func start(t *testing.T, image string) *harness {
	root := t.TempDir()
	h := &harness{t: t, secrets: filepath.Join(root, "secrets", "metabase"), password: randomHex(t)}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	h.key = key
	h.issuer = newIssuer(t, key)

	if err := os.MkdirAll(h.secrets, 0o755); err != nil {
		t.Fatal(err)
	}
	h.writeSecret("first", "first-password-0123456789")
	h.writeSecret("second", "second-password-0123456789")
	access := fmt.Sprintf(`issuers:
  - {name: staff, url: '%s', username_claim: email, required_claims: {email_verified: true}}
users:
  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: /access/secrets/metabase}}}
  - {name: alice, tier: read, databases: [analytics], login: {token: {issuer: staff, subject: alice@example.com}}}
`, h.issuer.URL)
	if err := os.WriteFile(filepath.Join(root, "access.yaml"), []byte(access), 0o644); err != nil {
		t.Fatal(err)
	}
	// The container runs as uid 101 and must read what this process wrote.
	if err := os.Chmod(root, 0o755); err != nil {
		t.Fatal(err)
	}

	_ = exec.Command("docker", "rm", "-f", container).Run()
	// Host networking: the sidecar reaches the test's issuer on loopback, which
	// is the only plain-http issuer it accepts.
	run := exec.Command("docker", "run", "-d", "--name", container, "--network", "host",
		"-e", "CH_CPU=2", "-e", "CH_RAM=2147483648",
		"-e", "CLICKHOUSE_PASSWORD="+h.password,
		"-e", "CLICKHOUSE_ACCESS_FILE=/access/access.yaml",
		"-v", root+":/access:ro", image)
	if out, err := run.CombinedOutput(); err != nil {
		t.Fatalf("docker run: %v\n%s", err, out)
	}
	t.Cleanup(func() {
		if t.Failed() {
			logs, _ := exec.Command("docker", "logs", "--tail", "80", container).CombinedOutput()
			t.Logf("container logs:\n%s", logs)
		}
		_ = exec.Command("docker", "rm", "-f", container).Run()
	})
	h.eventually(func() bool {
		_, err := h.query("default", h.password, "SELECT 1")
		return err == nil
	}, "ClickHouse did not start")
	return h
}

func (h *harness) writeSecret(name, value string) {
	h.t.Helper()
	if err := os.WriteFile(filepath.Join(h.secrets, name), []byte(value+"\n"), 0o644); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) admin(sql string) {
	h.t.Helper()
	if _, err := h.query("default", h.password, sql); err != nil {
		h.t.Fatalf("%s: %v", sql, err)
	}
}

// query runs sql over HTTP as user, returning the trimmed body or the error body.
func (h *harness) query(user, password, sql string) (string, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "http://127.0.0.1:8123/", strings.NewReader(sql))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(user, password)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return strings.TrimSpace(string(body)), nil
}

// native runs sql over the native protocol with the image's own client.
func (h *harness) native(user, password, sql string) (string, error) {
	out, err := exec.Command("docker", "exec", container, "clickhouse-client",
		"--user", user, "--password", password, "--query", sql).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func (h *harness) token(email string, exp time.Time) string {
	h.t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: h.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "e2e"))
	if err != nil {
		h.t.Fatal(err)
	}
	// Padding makes the token the size of a real IdP's, with groups and names.
	token, err := jwt.Signed(signer).Claims(map[string]any{
		"iss": h.issuer.URL, "aud": "clickhouse", "sub": "user-" + email,
		"email": email, "email_verified": true, "exp": exp.Unix(), "iat": time.Now().Unix(),
		"groups": strings.Split(strings.Repeat("engineering-team,", 40), ","),
	}).Serialize()
	if err != nil {
		h.t.Fatal(err)
	}
	return token
}

func (h *harness) eventually(ok func() bool, failure string) {
	h.t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(time.Second)
	}
	h.t.Fatal(failure)
}

func newIssuer(t *testing.T, key *ecdsa.PrivateKey) *httptest.Server {
	var server *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": server.URL, "jwks_uri": server.URL + "/keys"})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &key.PublicKey, KeyID: "e2e", Algorithm: string(jose.ES256), Use: "sig"},
		}})
	})
	server = httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func randomHex(t *testing.T) string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}
