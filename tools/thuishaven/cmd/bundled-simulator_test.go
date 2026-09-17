package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"go.uber.org/zap"
)

// @scenario "An invalid bundled simulator invocation is refused"
func TestBundledSimulatorRejectsInvalidInvocation(t *testing.T) {
	for _, args := range [][]string{{}, {"gateway"}, {"mail", "extra"}, {"idp", "--unknown"}} {
		err := Root(t.Context(), zap.NewNop(), "test", append([]string{"simulator"}, args...))
		if err == nil || !strings.Contains(err.Error(), "simulator") {
			t.Errorf("simulator %v returned %v, want a simulator usage error", args, err)
		}
	}
}

// @scenario "A bundled simulator reports invalid configuration"
func TestBundledSimulatorRejectsInvalidConfiguration(t *testing.T) {
	for _, test := range []struct{ name, key string }{
		{"mail", "MAILSIM_MAX_MESSAGE_BYTES"},
		{"idp", "IDPSIM_TENANTS"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(test.key, "invalid")
			err := Root(t.Context(), zap.NewNop(), "test", []string{"simulator", test.name})
			if err == nil || !strings.Contains(err.Error(), test.key) {
				t.Fatalf("got %v, want an error naming %s", err, test.key)
			}
		})
	}
}

// @scenario "Bundled simulators serve browsers without a checkout or build tools"
func TestBundledSimulatorsWithoutCheckout(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "haven")
	build := exec.CommandContext(t.Context(), "go", "build", "-o", binary, "../../../cmd/haven")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build haven: %v\n%s", err, output)
	}

	t.Run("mail", func(t *testing.T) {
		httpAddr, smtpAddr := simulatorTestAddress(t), simulatorTestAddress(t)
		stop := startSimulatorBinary(t, binary, "mail", []string{
			"MAILSIM_HTTP_ADDR=" + httpAddr, "MAILSIM_SMTP_ADDR=" + smtpAddr,
			"MAILSIM_DATA_DIR=" + t.TempDir(),
		}, "http://"+httpAddr+"/healthz")
		message := []byte("From: sender@example.test\r\nTo: inbox@example.test\r\nSubject: Bundled mail works\r\n\r\nCaught without a checkout.\r\n")
		if err := smtp.SendMail(smtpAddr, nil, "sender@example.test", []string{"inbox@example.test"}, message); err != nil {
			t.Fatal(err)
		}
		var inbox struct {
			Messages []struct{ ID, Subject string }
		}
		if err := json.Unmarshal(simulatorGET(t, "http://"+httpAddr+"/api/messages"), &inbox); err != nil {
			t.Fatal(err)
		}
		if len(inbox.Messages) != 1 || inbox.Messages[0].Subject != "Bundled mail works" {
			t.Fatalf("unexpected inbox: %+v", inbox)
		}
		page := simulatorGET(t, "http://"+httpAddr+"/messages/"+inbox.Messages[0].ID)
		if !bytes.Contains(page, []byte("Bundled mail works")) {
			t.Fatal("message browser page does not show the captured subject")
		}
		if len(simulatorGET(t, "http://"+httpAddr+"/assets/ui.js")) == 0 {
			t.Fatal("inbox browser script is empty")
		}
		stop()
		assertSimulatorPortClosed(t, httpAddr)
		assertSimulatorPortClosed(t, smtpAddr)
	})

	t.Run("idp", func(t *testing.T) {
		addr := simulatorTestAddress(t)
		baseURL := "http://" + addr
		stop := startSimulatorBinary(t, binary, "idp", []string{
			"SERVER_ADDR=" + addr, "IDPSIM_BASE_URL=" + baseURL,
			"IDPSIM_TENANTS=1", "IDPSIM_DNS_ADDR=off",
		}, baseURL+"/health")
		if !bytes.Contains(simulatorGET(t, baseURL+"/"), []byte("/t/1/")) {
			t.Fatal("IdP browser page does not link to its tenant")
		}
		var discovery struct{ Issuer string }
		if err := json.Unmarshal(simulatorGET(t, baseURL+"/t/1/.well-known/openid-configuration"), &discovery); err != nil {
			t.Fatal(err)
		}
		if discovery.Issuer != baseURL+"/t/1" {
			t.Fatalf("issuer = %q, want the configured simulator origin", discovery.Issuer)
		}
		assertBundledPopulation(t, baseURL)
		stop()
		assertSimulatorPortClosed(t, addr)
	})
}

func assertBundledPopulation(t *testing.T, baseURL string) {
	t.Helper()
	page := simulatorGET(t, baseURL+"/t/1/")
	if !bytes.Contains(page, []byte(`id="population"`)) || !bytes.Contains(page, []byte(">Generate</button>")) {
		t.Fatal("the bundled tenant page lost its directory-generation form")
	}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, test := range []struct {
		users  string
		status int
	}{{"500", http.StatusOK}, {"50001", http.StatusBadRequest}} {
		response, err := client.PostForm(baseURL+"/t/1/population", url.Values{"users": {test.users}, "groups": {"6"}})
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != test.status {
			t.Fatalf("generate %s users: status %d, want %d", test.users, response.StatusCode, test.status)
		}
		var state struct {
			Tenants []struct {
				Users  []struct{ Email string }
				Groups []struct{ ID string }
			}
		}
		if err := json.Unmarshal(simulatorGET(t, baseURL+"/control/state"), &state); err != nil {
			t.Fatal(err)
		}
		if len(state.Tenants) != 1 || len(state.Tenants[0].Users) != 500 || len(state.Tenants[0].Groups) != 6 {
			t.Fatalf("generate %s did not preserve a 500-user, 6-group directory", test.users)
		}
		seeded := 0
		for _, user := range state.Tenants[0].Users {
			if user.Email == "admin@acme1.test" || user.Email == "member@acme1.test" {
				seeded++
			}
		}
		if seeded != 2 {
			t.Fatal("generation removed the seeded login accounts")
		}
	}
}

func simulatorTestAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	return addr
}

func startSimulatorBinary(t *testing.T, binary, name string, env []string, healthURL string) func() {
	t.Helper()
	command := exec.Command(binary, "simulator", name)
	command.Dir = t.TempDir()
	command.Env = append([]string{"PATH=" + t.TempDir(), "HOME=" + t.TempDir(), "LOG_FORMAT=json"}, env...)
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	stopped := false
	stop := func() {
		t.Helper()
		if stopped {
			return
		}
		stopped = true
		_ = command.Process.Signal(syscall.SIGTERM)
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("%s exited: %v\n%s", name, err, output.String())
			}
		case <-time.After(10 * time.Second):
			_ = command.Process.Kill()
			<-done
			t.Errorf("%s did not stop after SIGTERM", name)
		}
	}
	t.Cleanup(stop)
	client := &http.Client{Timeout: 200 * time.Millisecond}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			stopped = true
			t.Fatalf("%s exited before readiness: %v\n%s", name, err, output.String())
		default:
		}
		response, err := client.Get(healthURL)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return stop
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	stop()
	t.Fatalf("%s never became ready: %s", name, output.String())
	return nil
}

func simulatorGET(t *testing.T, url string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d, %v", url, response.StatusCode, err)
	}
	return body
}

func assertSimulatorPortClosed(t *testing.T, addr string) {
	t.Helper()
	connection, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
	if err == nil {
		_ = connection.Close()
		t.Errorf("simulator still accepts connections on %s after shutdown", addr)
	}
}

func TestSimulatorArgvUsesRunningExecutable(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if got := simulatorArgv(); len(got) != 2 || got[0] != executable || got[1] != "simulator" {
		t.Fatalf("simulator argv = %q, want current executable", got)
	}
}
