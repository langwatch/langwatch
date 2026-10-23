package accesse2e

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/access"
	"github.com/langwatch/langwatch/infra/clickhouse-serverless/internal/bootstrap"
)

const dynContainer = "ch-e2e-dynamic"

// rotatingIssuer is an OIDC provider whose signing key the test can rotate.
type rotatingIssuer struct {
	server *httptest.Server
	mu     sync.Mutex
	kid    string
	key    *ecdsa.PrivateKey
}

func newRotatingIssuer(t *testing.T) *rotatingIssuer {
	is := &rotatingIssuer{}
	is.rotate(t, "k1")
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": is.server.URL, "jwks_uri": is.server.URL + "/keys"})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, _ *http.Request) {
		is.mu.Lock()
		defer is.mu.Unlock()
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &is.key.PublicKey, KeyID: is.kid, Algorithm: string(jose.ES256), Use: "sig"},
		}})
	})
	is.server = httptest.NewServer(mux)
	t.Cleanup(is.server.Close)
	return is
}

// rotate replaces the published key: tokens of the old key stop verifying
// once the sidecar refetches.
func (is *rotatingIssuer) rotate(t *testing.T, kid string) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	is.mu.Lock()
	defer is.mu.Unlock()
	is.kid, is.key = kid, key
}

func (is *rotatingIssuer) current() (string, *ecdsa.PrivateKey) {
	is.mu.Lock()
	defer is.mu.Unlock()
	return is.kid, is.key
}

type dynHarness struct {
	t      *testing.T
	root   string
	staff  *rotatingIssuer
	other  *rotatingIssuer
	access string
}

// @scenario "A dynamic-only server accepts short-lived tokens and no password"
func TestDynamicOnlyAgainstRealClickHouse(t *testing.T) {
	image := os.Getenv("CH_ACCESS_E2E_IMAGE")
	if image == "" {
		t.Skip("CH_ACCESS_E2E_IMAGE not set; run `make e2e-access` (needs Docker)")
	}
	h := &dynHarness{t: t, root: t.TempDir(), staff: newRotatingIssuer(t), other: newRotatingIssuer(t)}
	if err := os.Chmod(h.root, 0o755); err != nil {
		t.Fatal(err)
	}
	h.access = fmt.Sprintf(`mode: dynamic-only
issuers:
  - {name: staff, url: '%s', username_claim: email}
  - {name: other, url: '%s', username_claim: email}
users:
  - {name: reader, tier: read, databases: [analytics], login: {token: {issuer: staff, subject: reader@example.com}}}
  - {name: writer, tier: write, databases: [analytics], login: {token: {issuer: staff, subject: writer@example.com}}}
  - {name: auditor, tier: inspect, login: {token: {issuer: staff, subject: auditor@example.com}}}
`, h.staff.server.URL, h.other.server.URL)

	t.Run("the server refuses to start with a long-lived password", func(t *testing.T) {
		rolling := h.access + "  - {name: metabase, tier: read, databases: [analytics], login: {rolling: {dir: /access/secrets}}}\n"
		out := h.runOnce(t, image, rolling)
		if !strings.Contains(out, "refused in dynamic-only mode") {
			t.Errorf("a rolling user started:\n%s", out)
		}
		out = h.runOnce(t, image, h.access, "-e", "CLICKHOUSE_PASSWORD="+strings.Repeat("x", 24))
		if !strings.Contains(out, "unset CLICKHOUSE_PASSWORD") {
			t.Errorf("a default password started:\n%s", out)
		}
	})

	h.start(image)
	h.admin("CREATE DATABASE analytics")
	h.admin("CREATE DATABASE private")
	h.admin("CREATE TABLE analytics.events (x UInt8) ENGINE = MergeTree ORDER BY x")
	h.admin("CREATE TABLE private.secrets (x UInt8) ENGINE = MergeTree ORDER BY x")
	h.admin("INSERT INTO analytics.events VALUES (1), (2)")

	t.Run("no password logs in, for any user, over HTTP or native", func(t *testing.T) {
		adminPassword := h.adminPassword()
		for _, c := range []struct{ user, password string }{
			{"default", ""}, {"default", "default"}, {"default", "clickhouse"}, {"default", adminPassword},
			{"reader", ""}, {"reader", "not-a-token-0123456789"}, {"nobody", ""},
		} {
			if _, err := dynQuery("127.0.0.1", c.user, c.password, "SELECT 1"); err == nil {
				t.Errorf("HTTP login as %s with %q succeeded", c.user, c.password)
			}
			if _, err := h.native("127.0.0.1", c.user, c.password, "SELECT 1"); err == nil {
				t.Errorf("native login as %s with %q succeeded", c.user, c.password)
			}
		}
		ip := nonLoopbackIP(t)
		if _, err := dynQuery(ip, bootstrap.User, adminPassword, "SELECT 1"); err == nil {
			t.Errorf("the local admin logged in over HTTP from %s", ip)
		}
		if _, err := h.native(ip, bootstrap.User, adminPassword, "SELECT 1"); err == nil {
			t.Errorf("the local admin logged in over native from %s", ip)
		}
		if _, err := dynQuery("127.0.0.1", bootstrap.User, adminPassword, "SELECT 1"); err != nil {
			t.Errorf("control: the local admin cannot log in from loopback: %v", err)
		}
	})

	t.Run("a SQL password cannot be created, and the audit finds none", func(t *testing.T) {
		_, err := dynQuery("127.0.0.1", bootstrap.User, h.adminPassword(), "CREATE USER sneaky IDENTIFIED BY 'a-long-static-password-0123'")
		if err == nil {
			t.Error("CREATE USER ... IDENTIFIED BY succeeded")
		}
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, bootstrap.PasswordFile), []byte(h.adminPassword()), 0o400); err != nil {
			t.Fatal(err)
		}
		found, err := access.PasswordLogins(context.Background(), &bootstrap.Client{Dir: dir})
		if err != nil || len(found) != 0 {
			t.Errorf("PasswordLogins = %v, %v; want none", found, err)
		}
	})

	t.Run("a token gets exactly its tier's rights", func(t *testing.T) {
		reader := h.token(h.staff, "reader@example.com", time.Now().Add(10*time.Minute), nil)
		if out, err := dynQuery("127.0.0.1", "reader", reader, "SELECT count() FROM analytics.events"); err != nil || out != "2" {
			t.Errorf("reader select over HTTP: %q, %v", out, err)
		}
		out, err := h.native("127.0.0.1", "reader", reader, "SELECT count() FROM analytics.events")
		t.Logf("native token login of %d bytes: %q, %v", len(reader), out, err)
		if err != nil || out != "2" {
			t.Errorf("reader select over native: %q, %v", out, err)
		}
		for _, sql := range []string{"INSERT INTO analytics.events VALUES (3)", "SELECT count() FROM private.secrets", "SELECT count() FROM system.query_log"} {
			if _, err := dynQuery("127.0.0.1", "reader", reader, sql); err == nil {
				t.Errorf("reader ran %s", sql)
			}
		}
		writer := h.token(h.staff, "writer@example.com", time.Now().Add(10*time.Minute), nil)
		if _, err := dynQuery("127.0.0.1", "writer", writer, "INSERT INTO analytics.events VALUES (3)"); err != nil {
			t.Errorf("writer insert: %v", err)
		}
		if _, err := dynQuery("127.0.0.1", "writer", writer, "CREATE TABLE analytics.t (x UInt8) ENGINE = Memory"); err == nil {
			t.Error("writer ran DDL")
		}
		auditor := h.token(h.staff, "auditor@example.com", time.Now().Add(10*time.Minute), nil)
		if out, err := dynQuery("127.0.0.1", "auditor", auditor, "SHOW TABLES FROM analytics"); err != nil || out != "events" {
			t.Errorf("auditor show tables: %q, %v", out, err)
		}
		if _, err := dynQuery("127.0.0.1", "auditor", auditor, "SELECT count() FROM analytics.events"); err == nil {
			t.Error("auditor read rows")
		}
	})

	t.Run("a token fails the moment it expires", func(t *testing.T) {
		exp := time.Now().Add(8 * time.Second)
		token := h.token(h.staff, "reader@example.com", exp, nil)
		if _, err := dynQuery("127.0.0.1", "reader", token, "SELECT 1"); err != nil {
			t.Fatalf("before exp: %v", err)
		}
		if _, err := h.native("127.0.0.1", "reader", token, "SELECT 1"); err != nil {
			t.Fatalf("before exp, native: %v", err)
		}
		time.Sleep(time.Until(exp.Truncate(time.Second).Add(1200 * time.Millisecond)))
		if _, err := dynQuery("127.0.0.1", "reader", token, "SELECT 1"); err == nil {
			t.Error("an expired token logged in over HTTP")
		}
		if _, err := h.native("127.0.0.1", "reader", token, "SELECT 1"); err == nil {
			t.Error("an expired token logged in over native")
		}
	})

	t.Run("a token is refused unless it is for this user, issuer, audience and key", func(t *testing.T) {
		exp := time.Now().Add(10 * time.Minute)
		otherKid, otherKey := h.other.current()
		forged, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		for name, token := range map[string]string{
			"wrong audience": h.token(h.staff, "reader@example.com", exp, map[string]any{"aud": "grafana"}),
			"wrong issuer":   h.token(h.staff, "reader@example.com", exp, map[string]any{"iss": h.other.server.URL}),
			"another issuer's key": h.sign(otherKid, otherKey, map[string]any{
				"iss": h.other.server.URL, "aud": "clickhouse", "email": "reader@example.com", "exp": exp.Unix(),
			}),
			"unknown key": h.sign("forged", forged, map[string]any{
				"iss": h.staff.server.URL, "aud": "clickhouse", "email": "reader@example.com", "exp": exp.Unix(),
			}),
			"another user's token": h.token(h.staff, "writer@example.com", exp, nil),
		} {
			if _, err := dynQuery("127.0.0.1", "reader", token, "SELECT 1"); err == nil {
				t.Errorf("%s: logged in over HTTP", name)
			}
			if _, err := h.native("127.0.0.1", "reader", token, "SELECT 1"); err == nil {
				t.Errorf("%s: logged in over native", name)
			}
		}
	})

	t.Run("a rotated issuer key works mid-run", func(t *testing.T) {
		h.staff.rotate(t, "k2")
		token := h.token(h.staff, "reader@example.com", time.Now().Add(10*time.Minute), nil)
		h.eventually(90*time.Second, func() bool {
			_, err := dynQuery("127.0.0.1", "reader", token, "SELECT 1")
			return err == nil
		}, "a token signed by the rotated key never logged in")
	})

	t.Run("a sidecar restart does not stop new logins for long", func(t *testing.T) {
		if out, err := exec.Command("docker", "exec", dynContainer, "sh", "-c",
			`for p in /proc/[0-9]*; do tr '\0' ' ' < $p/cmdline 2>/dev/null | grep -q '^ch-config sidecar' && kill ${p#/proc/}; done; true`).CombinedOutput(); err != nil {
			t.Fatalf("kill the sidecar: %v\n%s", err, out)
		}
		killed := time.Now()
		token := h.token(h.staff, "reader@example.com", time.Now().Add(10*time.Minute), nil)
		h.eventually(30*time.Second, func() bool {
			_, err := dynQuery("127.0.0.1", "reader", token, "SELECT 1")
			return err == nil
		}, "new token logins did not come back within 30 s of a sidecar restart")
		t.Logf("new logins back %s after the sidecar was killed", time.Since(killed).Round(100*time.Millisecond))
	})

	t.Run("a server restart rotates the local admin password", func(t *testing.T) {
		old := h.adminPassword()
		if out, err := exec.Command("docker", "restart", dynContainer).CombinedOutput(); err != nil {
			t.Fatalf("docker restart: %v\n%s", err, out)
		}
		h.waitReady()
		current := h.adminPassword()
		if current == old {
			t.Fatal("the local admin password survived a restart")
		}
		if _, err := dynQuery("127.0.0.1", bootstrap.User, old, "SELECT 1"); err == nil {
			t.Error("the old local admin password still logs in over HTTP")
		}
		if _, err := h.native("127.0.0.1", bootstrap.User, old, "SELECT 1"); err == nil {
			t.Error("the old local admin password still logs in over native")
		}
		if _, err := dynQuery("127.0.0.1", bootstrap.User, current, "SELECT 1"); err != nil {
			t.Errorf("the new local admin password does not log in: %v", err)
		}
	})
}

// runOnce starts the image in the foreground with access and returns its
// output, failing the test if it keeps running or exits 0.
func (h *dynHarness) runOnce(t *testing.T, image, accessYAML string, extra ...string) string {
	t.Helper()
	dir := t.TempDir()
	_ = os.Chmod(dir, 0o755)
	if err := os.WriteFile(filepath.Join(dir, "access.yaml"), []byte(accessYAML), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "secrets"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "secrets", "current"), []byte("a-long-static-password-0123"), 0o644)
	args := append([]string{"run", "--rm", "--network", "host",
		"-e", "CH_CPU=2", "-e", "CH_RAM=2147483648",
		"-e", "CLICKHOUSE_ACCESS_FILE=/access/access.yaml",
		"--tmpfs", "/run/clickhouse-access:uid=101,gid=101,mode=0750",
		"-v", dir + ":/access:ro"}, extra...)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "docker", append(args, image)...).CombinedOutput()
	if err == nil || ctx.Err() != nil {
		t.Fatalf("the image did not refuse to start (err %v):\n%s", err, out)
	}
	return string(out)
}

func (h *dynHarness) start(image string) {
	t := h.t
	if err := os.WriteFile(filepath.Join(h.root, "access.yaml"), []byte(h.access), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = exec.Command("docker", "rm", "-f", dynContainer).Run()
	run := exec.Command("docker", "run", "-d", "--name", dynContainer, "--network", "host",
		"-e", "CH_CPU=2", "-e", "CH_RAM=2147483648",
		"-e", "CLICKHOUSE_ACCESS_FILE=/access/access.yaml",
		"--tmpfs", "/run/clickhouse-access:uid=101,gid=101,mode=0750",
		"-v", h.root+":/access:ro", image)
	if out, err := run.CombinedOutput(); err != nil {
		t.Fatalf("docker run: %v\n%s", err, out)
	}
	t.Cleanup(func() {
		if t.Failed() {
			logs, _ := exec.Command("docker", "logs", "--tail", "120", dynContainer).CombinedOutput()
			t.Logf("container logs:\n%s", logs)
		}
		_ = exec.Command("docker", "rm", "-f", dynContainer).Run()
	})
	h.waitReady()
}

// waitReady waits for the local admin and a token login to work.
func (h *dynHarness) waitReady() {
	h.eventually(90*time.Second, func() bool {
		pw, err := h.tryAdminPassword()
		if err != nil {
			return false
		}
		_, err = dynQuery("127.0.0.1", bootstrap.User, pw, "SELECT 1")
		return err == nil
	}, "ClickHouse did not start")
}

func (h *dynHarness) tryAdminPassword() (string, error) {
	out, err := exec.Command("docker", "exec", dynContainer, "cat", "/run/clickhouse-access/"+bootstrap.PasswordFile).Output()
	return strings.TrimSpace(string(out)), err
}

func (h *dynHarness) adminPassword() string {
	h.t.Helper()
	pw, err := h.tryAdminPassword()
	if err != nil {
		h.t.Fatalf("read the local admin password: %v", err)
	}
	return pw
}

func (h *dynHarness) admin(sql string) {
	h.t.Helper()
	if _, err := dynQuery("127.0.0.1", bootstrap.User, h.adminPassword(), sql); err != nil {
		h.t.Fatalf("%s: %v", sql, err)
	}
}

// native runs sql over the native protocol from inside the container, which
// shares the host's network, against host.
func (h *dynHarness) native(host, user, password, sql string) (string, error) {
	out, err := exec.Command("docker", "exec", dynContainer, "clickhouse-client", "--host", host,
		"--user", user, "--password", password, "--query", sql).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func (h *dynHarness) token(is *rotatingIssuer, email string, exp time.Time, override map[string]any) string {
	kid, key := is.current()
	claims := map[string]any{
		"iss": is.server.URL, "aud": "clickhouse", "sub": "user-" + email, "email": email,
		"exp": exp.Unix(), "iat": time.Now().Unix(),
	}
	for k, v := range override {
		claims[k] = v
	}
	return h.sign(kid, key, claims)
}

func (h *dynHarness) sign(kid string, key *ecdsa.PrivateKey, claims map[string]any) string {
	h.t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", kid))
	if err != nil {
		h.t.Fatal(err)
	}
	token, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		h.t.Fatal(err)
	}
	return token
}

func (h *dynHarness) eventually(limit time.Duration, ok func() bool, failure string) {
	h.t.Helper()
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	h.t.Fatal(failure)
}

// dynQuery runs sql over HTTP against host:8123.
func dynQuery(host, user, password, sql string) (string, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, "http://"+net.JoinHostPort(host, "8123")+"/", strings.NewReader(sql))
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

// nonLoopbackIP is an address of this host the server sees as not loopback.
func nonLoopbackIP(t *testing.T) string {
	t.Helper()
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	t.Skip("no non-loopback IPv4 address on this host")
	return ""
}
