package cmd

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
)

// The `haven browser` noun: one light headless browser per stack (Playwright's
// chromium-headless-shell, apps/haven-web/scripts/browser-daemon.ts), started
// on first use, one context per lane signed in by `haven auth`. The daemon
// re-signs a lane in when its page lands on sign-in and exits once no lane
// is left; every command waits on page events, never a fixed sleep.

const browserUsage = "usage: haven browser <open|goto|snapshot|click|fill|select|type|press|screenshot|eval|state-load|record|replay|close|status|stop> [args] --lane <name> [--as admin|email]"

// browserStartTimeout bounds the daemon's first line: a cold browser on a loaded machine.
const browserStartTimeout = 90 * time.Second

func browserSpec() commandSpec {
	return commandSpec{
		name:    "browser",
		summary: "one shared headless browser per stack, a signed-in context per --lane, playwright-cli's verbs: open | goto | snapshot | click | fill | select | type | press | screenshot | eval | state-load | record | replay | close | status | stop",
		args:    "<verb> [ref|selector|url|text|key|expression|file] [text]",
		maxArgs: 3,
		flags: []flagSpec{
			{long: "--lane", takesValue: true, value: "<name>", summary: "the caller's own context; lanes never share one"},
			{long: "--as", takesValue: true, value: "<admin|email>", summary: "sign the lane in as this login (haven auth); omit to stay signed out"},
			{long: "--wait-for", takesValue: true, value: "<selector>", summary: "also wait for this CSS or text= selector before answering"},
			{long: "--out", takesValue: true, value: "<file>", summary: "screenshot: where to write the PNG; record stop: where to write the script"},
			{long: "--playwright", takesValue: true, value: "<file>", summary: "record export: where to write the Playwright test"},
			{long: "--timeout", takesValue: true, value: "<dur>", summary: "how long a command may wait on the page (default 30s)"},
			{long: "--json", summary: "machine-readable"},
			{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
		},
		run: runBrowser,
	}
}

// browserDir is where a stack's browser keeps its daemon record, logs and lane sign-ins.
func browserDir(slug string) string { return filepath.Join(havenHome(), "browser", slug) }

// browserDaemon is the record the CLI writes once the daemon is listening (mode 600).
type browserDaemon struct {
	Port  int    `json:"port"`
	PID   int    `json:"pid"`
	Token string `json:"token"`
}

func runBrowser(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) == 0 {
		return errors.New(browserUsage)
	}
	verb := inv.args[0]
	if verb == "record" {
		var err error
		if verb, inv, err = recordVerb(inv); err != nil {
			return err
		}
		if verb == "export" {
			return exportScript(inv)
		}
	}
	slug, err := d.orch.ResolveSlug(authParams(d, inv))
	if err != nil {
		return err
	}
	dir := browserDir(slug)
	if verb == "stop" || verb == "status" {
		return browserControl(dir, verb, inv.has("--json") || d.isAgent)
	}
	req, err := browserRequest(verb, inv)
	if err != nil {
		return err
	}
	daemon, err := ensureBrowser(ctx, d, inv, slug, dir)
	if err != nil {
		return err
	}
	if verb == "replay" {
		script, err := readScript(inv.args[1])
		if err != nil {
			return err
		}
		req["script"] = script
	}
	var reply map[string]any
	if err := daemon.call(ctx, verb, req, &reply); err != nil {
		return err
	}
	if verb == "record-stop" {
		return writeScript(reply, req["out"], inv.has("--json") || d.isAgent)
	}
	if verb == "replay" {
		return printReplay(reply, inv.has("--json") || d.isAgent)
	}
	return printBrowserReply(verb, reply, inv.has("--json") || d.isAgent)
}

// browserRequest maps the flags onto the daemon's request body.
func browserRequest(verb string, inv invocation) (map[string]any, error) {
	lane := inv.value("--lane")
	if lane == "" {
		return nil, errors.New("haven browser " + verb + " needs --lane <name>: every lane drives its own context")
	}
	timeout := 30 * time.Second
	if raw := inv.value("--timeout"); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			return nil, fmt.Errorf("--timeout %q is not a duration", raw)
		}
		timeout = parsed
	}
	req := map[string]any{"lane": lane, "as": inv.value("--as"), "waitFor": inv.value("--wait-for"), "timeoutMs": timeout.Milliseconds()}
	fields, ok := browserVerbArgs[verb]
	if !ok {
		return nil, errors.New(browserUsage)
	}
	given := inv.args[1:]
	for i, field := range fields {
		optional := strings.HasSuffix(field, "?")
		field = strings.TrimSuffix(field, "?")
		if i >= len(given) {
			if !optional {
				return nil, fmt.Errorf("haven browser %s needs <%s>", verb, field)
			}
			continue
		}
		req[field] = given[i]
	}
	if len(given) > len(fields) {
		return nil, fmt.Errorf("haven browser %s takes %d argument(s)", verb, len(fields))
	}
	for _, field := range []string{"file", "out"} {
		if raw, ok := req[field].(string); ok {
			abs, err := filepath.Abs(raw)
			if err != nil {
				return nil, err
			}
			req[field] = abs
		}
	}
	if verb == "screenshot" || verb == "record-stop" {
		out := inv.value("--out")
		if out == "" {
			ext := ".png"
			if verb == "record-stop" {
				ext = ".json"
			}
			out = filepath.Join(".claude", "tmp", "haven-browser", lane+"-"+time.Now().Format("150405")+ext)
		}
		abs, err := filepath.Abs(out)
		if err != nil {
			return nil, err
		}
		req["out"] = abs
	}
	return req, nil
}

// browserVerbArgs names each verb's positionals, as playwright-cli spells them; "?" is optional.
var browserVerbArgs = map[string][]string{
	"open": {"url?"}, "goto": {"url"}, "snapshot": nil, "screenshot": nil, "close": nil,
	"click": {"ref"}, "fill": {"ref", "text"}, "select": {"ref", "text"}, "type": {"text"}, "press": {"key"},
	"eval": {"expression"}, "state-load": {"file"},
	"record-start": nil, "record-stop": nil, "replay": {"file"},
}

func printBrowserReply(verb string, reply map[string]any, asJSON bool) error {
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(reply)
	}
	switch verb {
	case "snapshot":
		fmt.Printf("- Page URL: %v\n- Page Title: %v\n%v\n", reply["url"], reply["title"], reply["snapshot"])
	case "screenshot":
		fmt.Printf("%v\n", reply["file"])
	case "eval":
		value, _ := json.Marshal(reply["value"])
		fmt.Println(string(value))
	case "close":
		fmt.Println("closed")
	default:
		fmt.Printf("%v  %v\n", reply["url"], reply["title"])
	}
	return nil
}

// browserControl is `status` and `stop`: they talk to a running daemon and never start one.
func browserControl(dir, verb string, asJSON bool) error {
	daemon, ok := readBrowserDaemon(dir)
	var reply map[string]any
	if ok {
		ok = daemon.call(context.Background(), verb, map[string]any{}, &reply) == nil
	}
	if !ok {
		reply = map[string]any{"running": false}
	}
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(reply)
	}
	if !ok {
		fmt.Println("no browser running for this stack")
		return nil
	}
	if verb == "stop" {
		fmt.Println("browser stopped")
		return nil
	}
	fmt.Printf("browser pid %d, lanes %v\n", daemon.PID, reply["lanes"])
	return nil
}

// stopBrowser stops slug's browser if one runs; `haven down` calls it.
func stopBrowser(slug string) {
	if daemon, ok := readBrowserDaemon(browserDir(slug)); ok {
		_ = daemon.call(context.Background(), "stop", map[string]any{}, nil)
	}
}

func readBrowserDaemon(dir string) (browserDaemon, bool) {
	var daemon browserDaemon
	data, err := os.ReadFile(filepath.Join(dir, "daemon.json"))
	if err != nil || json.Unmarshal(data, &daemon) != nil || daemon.Port == 0 {
		return daemon, false
	}
	return daemon, syscall.Kill(daemon.PID, 0) == nil
}

// ensureBrowser returns the stack's running daemon, starting one under a lock
// so lanes arriving together share a single browser.
func ensureBrowser(ctx context.Context, d deps, inv invocation, slug, dir string) (browserDaemon, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return browserDaemon{}, err
	}
	lock, err := os.OpenFile(filepath.Join(dir, "daemon.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return browserDaemon{}, err
	}
	defer func() { _ = lock.Close() }()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return browserDaemon{}, err
	}
	if daemon, ok := readBrowserDaemon(dir); ok {
		return daemon, nil
	}
	overlay := telemetryOverlay(d, inv)
	appURL := telemetryOverlayValue(overlay, "LANGWATCH_ENDPOINT")
	if appURL == "" {
		return browserDaemon{}, errors.New("this worktree has no running stack; run haven up --agent -d")
	}
	if _, err := localApp(appURL); err != nil {
		return browserDaemon{}, err
	}
	return startBrowser(ctx, browserStart{dir: dir, slug: slug, appURL: appURL, worktree: d.worktree, appLog: appLogPath(d.orch.LogDir(slug))})
}

// appLogPath is the Node host's log, whose ready line ends a backend reload (app/reload.go).
func appLogPath(logDir string) string {
	if log := filepath.Join(logDir, "app.log"); fileExists(log) {
		return log
	}
	return filepath.Join(logDir, "api.log")
}

func fileExists(path string) bool { _, err := os.Stat(path); return err == nil }

type browserStart struct {
	dir, slug, appURL, worktree, appLog string
}

func startBrowser(ctx context.Context, s browserStart) (browserDaemon, error) {
	self, err := os.Executable()
	if err != nil {
		return browserDaemon{}, err
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return browserDaemon{}, err
	}
	daemon := browserDaemon{Token: hex.EncodeToString(token)}
	logFile, err := os.OpenFile(filepath.Join(s.dir, "daemon.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return daemon, err
	}
	defer func() { _ = logFile.Close() }()
	web := filepath.Join(s.worktree, "apps", "haven-web")
	child := exec.Command("node", filepath.Join(web, "scripts", "browser-daemon.ts"))
	child.Dir = web
	child.Env = append(os.Environ(), "HAVEN_BROWSER_TOKEN="+daemon.Token, "HAVEN_BROWSER_DIR="+s.dir, "HAVEN_BROWSER_STACK="+s.slug,
		"HAVEN_BROWSER_APP="+s.appURL, "HAVEN_BROWSER_HAVEN="+self, "HAVEN_BROWSER_APP_LOG="+s.appLog)
	child.Stderr = logFile
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	stdout, err := child.StdoutPipe()
	if err != nil {
		return daemon, err
	}
	if err := child.Start(); err != nil {
		return daemon, fmt.Errorf("starting the browser (node): %w", err)
	}
	daemon.PID = child.Process.Pid
	port, err := browserFirstLine(ctx, stdout)
	if err != nil {
		_ = child.Process.Kill()
		return daemon, fmt.Errorf("the browser did not start: %w — see %s", err, filepath.Join(s.dir, "daemon.log"))
	}
	daemon.Port = port
	_ = child.Process.Release()
	data, _ := json.Marshal(daemon)
	return daemon, atomicfile.Write(filepath.Join(s.dir, "daemon.json"), data, 0o600)
}

// browserFirstLine waits for the daemon's one stdout line, {"port":N}, the
// event that says it listens.
func browserFirstLine(ctx context.Context, stdout io.Reader) (int, error) {
	type first struct {
		port int
		err  error
	}
	done := make(chan first, 1)
	go func() {
		line, err := bufio.NewReader(stdout).ReadBytes('\n')
		var hello struct {
			Port int `json:"port"`
		}
		if err == nil {
			err = json.Unmarshal(line, &hello)
		}
		done <- first{hello.Port, err}
	}()
	select {
	case got := <-done:
		if got.err == nil && got.port == 0 {
			got.err = errors.New("no port in its first line")
		}
		return got.port, got.err
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-time.After(browserStartTimeout):
		return 0, fmt.Errorf("no answer within %s", browserStartTimeout)
	}
}

// call posts one command to the daemon and decodes its JSON answer.
func (b browserDaemon) call(ctx context.Context, verb string, body map[string]any, into any) error {
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/%s", b.Port, verb), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+b.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		return fmt.Errorf("the browser did not answer: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	reply, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		var failed struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(reply, &failed) == nil && failed.Error != "" {
			return errors.New(failed.Error)
		}
		return fmt.Errorf("browser %s answered %s: %s", verb, resp.Status, strings.TrimSpace(string(reply)))
	}
	if into == nil {
		return nil
	}
	return json.Unmarshal(reply, into)
}
