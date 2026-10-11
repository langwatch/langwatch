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
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The `haven browser` noun: one light headless browser per machine (Playwright's
// chromium-headless-shell, apps/haven-web/scripts/browser-daemon.ts), started on first
// use, one context per stack and lane signed in by `haven browser login --as`. The
// daemon re-signs a lane in when its page lands on sign-in and exits once no lane is
// left; every command waits on page events, never a fixed sleep.

const browserUsage = "usage: haven browser <open|goto|snapshot|click|hover|drag|upload|fill|select|type|press|screenshot|eval|state-load|record|replay|route|network|console|profile|lean|close|status|stop> [args] --lane <name> [--as admin|email]"

// browserProtocol is the request shape this CLI speaks; the daemon prints its own.
const browserProtocol = 2

// browserStartTimeout bounds the daemon's first line: a cold browser on a loaded machine.
const browserStartTimeout = 90 * time.Second

func browserSpec() commandSpec {
	return commandSpec{
		name:    "browser",
		summary: "one shared headless browser per machine, a signed-in context per stack and --lane, playwright-cli's verbs: open | goto | snapshot | click | hover | drag | upload | fill | select | type | press | screenshot | eval | state-load | record | replay | route | network | console | profile | lean | close | status | stop",
		args:    "<verb> [ref|selector|url|text|key|expression|file] [text|file...]",
		maxArgs: -1,
		flags: []flagSpec{
			{long: "--lane", takesValue: true, value: "<name>", summary: "the caller's own context; lanes never share one"},
			{long: "--as", takesValue: true, value: "<admin|email>", summary: "sign the lane in as this login (haven browser login --as); omit to stay signed out"},
			{long: "--wait-for", takesValue: true, value: "<selector>", summary: "also wait for this CSS or text= selector before answering"},
			{long: "--out", takesValue: true, value: "<file>", summary: "screenshot: where to write the PNG; record stop or save: where to write the script"},
			{long: "--download-to", takesValue: true, value: "<path>", summary: "click: save the download the click starts to this file and print its name, size and mediaType as JSON"},
			{long: "--playwright", takesValue: true, value: "<file>", summary: "record export: where to write the Playwright test"},
			{long: "--by", takesValue: true, value: "<dx,dy>", summary: "drag: move the element by this many pixels instead of onto a target"},
			{long: "--grep", takesValue: true, value: "<text>", summary: "snapshot: only nodes whose role or name contain text, plus their ancestors"},
			{long: "--depth", takesValue: true, value: "<n>", summary: "snapshot: only the first n levels of the tree"},
			{long: "--max-chars", takesValue: true, value: "<n>", summary: "snapshot: cut after n characters with a truncated footer"},
			{long: "--timeout", takesValue: true, value: "<dur>", summary: "how long a command may wait on the page (default 30s)"},
			{long: "--status", takesValue: true, value: "<code>", summary: "route add: the HTTP status matching requests answer (default 503)"},
			{long: "--times", takesValue: true, value: "<n>", summary: "route add: fault only the next n matches (default every match)"},
			{long: "--full", summary: "actions: print only url and title, no page diff"},
			{long: "--lean", summary: "turn lean on for the lane: images, fonts and media blocked, animations off"},
			{long: "--since-last", summary: "network, console: only what arrived since this lane's last read"},
			{long: "--failed", summary: "network: only failed requests and 4xx/5xx answers"},
			{long: "--all", summary: "network: include scripts, styles, images and fonts; stop: every stack's lanes and the browser"},
			{long: "--level", takesValue: true, value: "<debug|info|warning|error>", summary: "console: this level and above"},
			{long: "--json", summary: "machine-readable"},
			{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
		},
		run: runBrowser,
	}
}

// browserDir is where a stack's lanes keep their sign-ins and mfa state.
func browserDir(slug string) string { return filepath.Join(havenHome(), "browser", slug) }

// browserHome is where the machine's one browser keeps its daemon record, lock and log.
func browserHome() string { return filepath.Join(havenHome(), "browser") }

// browserHomeFor is where worktree's browser lives: the machine's, or the stack's own
// when the worktree's daemon script predates the shared browser (it cannot serve two stacks).
func browserHomeFor(worktree, slug string) string {
	if legacyDaemon(worktree) {
		return browserDir(slug)
	}
	return browserHome()
}

// legacyDaemon reports a worktree whose daemon script speaks no protocol (one browser per stack).
func legacyDaemon(worktree string) bool {
	data, err := os.ReadFile(filepath.Join(worktree, "apps", "haven-web", "scripts", "browser-daemon.ts"))
	return err == nil && !bytes.Contains(data, []byte("const PROTOCOL = "))
}

// runningBrowser is the browser serving slug: the machine's, else a legacy per-stack one.
func runningBrowser(slug string) (browserDaemon, bool) {
	if daemon, ok := readBrowserDaemon(browserHome()); ok {
		return daemon, true
	}
	return readBrowserDaemon(browserDir(slug))
}

// browserDaemon is the record the CLI writes once the daemon is listening (mode 600).
type browserDaemon struct {
	Port     int    `json:"port"`
	PID      int    `json:"pid"`
	Token    string `json:"token"`
	Protocol int    `json:"protocol"`
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
	if verb == "route" {
		var err error
		if verb, inv, err = routeVerb(inv); err != nil {
			return err
		}
	}
	if verb == "network" || verb == "profile" {
		var err error
		if verb, inv, err = observeVerb(inv); err != nil {
			return err
		}
	}
	if strings.HasPrefix(verb, "mfa-") {
		return errors.New(browserUsage)
	}
	return driveBrowser(ctx, d, verb, inv)
}

// driveBrowser sends one daemon verb for the lane; `haven browser mfa` shares it.
func driveBrowser(ctx context.Context, d deps, verb string, inv invocation) error {
	slug, err := d.orch.ResolveSlug(authParams(d, inv))
	if err != nil {
		return err
	}
	if verb == "stop" || verb == "status" {
		return browserControl(browserControlOptions{home: browserHomeFor(d.worktree, slug), slug: slug, verb: verb, all: inv.has("--all"), asJSON: inv.has("--json") || d.isAgent})
	}
	req, err := browserRequest(verb, inv)
	if err != nil {
		return err
	}
	daemon, stack, err := ensureBrowser(ctx, browserTarget{d: d, inv: inv, slug: slug})
	if err != nil {
		return err
	}
	req["stack"] = stack
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
	if verb == "record-stop" || verb == "record-save" {
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
	if _, ok := browserVerbArgs[verb]; !ok {
		return nil, errors.New(browserUsage)
	}
	given := inv.args[1:]
	if verb == "upload" {
		files, err := uploadFiles(given)
		if err != nil {
			return nil, err
		}
		req["files"] = files
		given = given[:1]
	}
	if err := fillPositionals(verb, given, req); err != nil {
		return nil, err
	}
	if err := browserExtras(verb, inv, req); err != nil {
		return nil, err
	}
	if err := mfaExtras(verb, inv, req); err != nil {
		return nil, err
	}
	if err := routeExtras(verb, inv, req); err != nil {
		return nil, err
	}
	if err := observeExtras(verb, inv, req); err != nil {
		return nil, err
	}
	if err := absolutise(req); err != nil {
		return nil, err
	}
	if verb == "screenshot" || verb == "record-stop" || verb == "record-save" || verb == "profile-stop" {
		out := inv.value("--out")
		if out == "" {
			ext := map[string]string{"screenshot": ".png", "record-stop": ".json", "record-save": ".json", "profile-stop": ".trace.json"}[verb]
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

// fillPositionals copies the verb's positional arguments into req; "?" marks an optional one.
func fillPositionals(verb string, given []string, req map[string]any) error {
	fields := browserVerbArgs[verb]
	for i, field := range fields {
		optional := strings.HasSuffix(field, "?")
		field = strings.TrimSuffix(field, "?")
		if i >= len(given) {
			if !optional {
				return fmt.Errorf("haven browser %s needs <%s>", verb, field)
			}
			continue
		}
		req[field] = given[i]
	}
	if len(given) > len(fields) {
		return fmt.Errorf("haven browser %s takes %d argument(s)", verb, len(fields))
	}
	return nil
}

// absolutise makes the file and out paths absolute: the daemon runs elsewhere.
func absolutise(req map[string]any) error {
	for _, field := range []string{"file", "out", "downloadTo"} {
		if raw, ok := req[field].(string); ok {
			abs, err := filepath.Abs(raw)
			if err != nil {
				return err
			}
			req[field] = abs
		}
	}
	return nil
}

// browserExtras maps drag's --by and snapshot's filters onto the request.
func browserExtras(verb string, inv invocation, req map[string]any) error {
	if by := inv.value("--by"); by != "" {
		var dx, dy int
		if _, err := fmt.Sscanf(by, "%d,%d", &dx, &dy); err != nil {
			return fmt.Errorf("--by %q is not dx,dy (for example 120,-40)", by)
		}
		req["by"] = map[string]any{"dx": dx, "dy": dy}
	}
	if verb == "drag" && req["targetRef"] == nil && req["by"] == nil {
		return errors.New("haven browser drag needs <targetRef> or --by dx,dy")
	}
	if to := inv.value("--download-to"); to != "" {
		if verb != "click" {
			return errors.New("--download-to is for haven browser click")
		}
		req["downloadTo"] = to
	}
	if grep := inv.value("--grep"); grep != "" {
		req["grep"] = grep
	}
	for flag, field := range map[string]string{"--depth": "depth", "--max-chars": "maxChars"} {
		raw := inv.value(flag)
		if raw == "" {
			continue
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return fmt.Errorf("%s %q is not a positive number", flag, raw)
		}
		req[field] = n
	}
	return nil
}

// browserVerbArgs names each verb's positionals, as playwright-cli spells them; "?" is optional.
var browserVerbArgs = map[string][]string{
	"open": {"url?"}, "goto": {"url"}, "snapshot": nil, "screenshot": nil, "close": nil,
	"click": {"ref"}, "hover": {"ref"}, "drag": {"ref", "targetRef?"}, "upload": {"ref"}, "fill": {"ref", "text"}, "select": {"ref", "text"}, "type": {"text"}, "press": {"key"},
	"eval": {"expression"}, "state-load": {"file"},
	"record-start": nil, "record-stop": nil, "record-save": nil, "replay": {"file"},
	"mfa-add": nil, "mfa-list": nil, "mfa-remove": {"authenticatorId"}, "mfa-uv": {"authenticatorId", "verified"},
	"mfa-totp-enroll": {"ref?"}, "mfa-totp-fill": {"ref"},
	"route-add": {"pattern"}, "route-off": {"pattern?"}, "route-list": nil,
	"network": nil, "network-show": {"id"}, "console": nil, "profile-start": nil, "profile-stop": nil, "lean": {"mode"},
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
	case "click":
		printClick(reply)
	case "open", "goto", "hover", "drag", "upload", "fill", "select", "type", "press":
		printAction(reply)
	case "network", "network-show", "console", "profile-start", "profile-stop", "lean":
		printObserve(verb, reply)
	case "eval":
		value, _ := json.Marshal(reply["value"])
		fmt.Println(string(value))
	case "close":
		fmt.Println("closed")
	case "mfa-add":
		fmt.Println(reply["authenticatorId"])
	case "mfa-list":
		printAuthenticators(reply)
	case "mfa-remove", "mfa-uv":
		fmt.Println("ok")
	case "mfa-totp-enroll":
		fmt.Printf("enrolled: %v digits every %vs (secret kept by the browser daemon)\n", reply["digits"], reply["period"])
	case "mfa-totp-fill":
		fmt.Println("filled")
	case "route-add", "route-off", "route-list":
		printRoute(verb, reply)
	default:
		fmt.Printf("%v  %v\n", reply["url"], reply["title"])
	}
	return nil
}

// printClick prints a download click's file as JSON, else the page it landed on.
func printClick(reply map[string]any) {
	if reply["file"] == nil {
		printAction(reply)
		return
	}
	_ = json.NewEncoder(os.Stdout).Encode(reply)
}

// browserControlOptions name a `status` or `stop` call.
type browserControlOptions struct {
	home, slug, verb string
	// all stops the machine's browser rather than this stack's lanes.
	all, asJSON bool
}

// browserControl is `status` and `stop`: they talk to a running daemon and never start one.
// `stop` closes this stack's lanes; with all it stops the machine's browser.
func browserControl(o browserControlOptions) error {
	daemon, ok := readBrowserDaemon(o.home)
	var reply map[string]any
	if ok {
		body := map[string]any{"stack": map[string]any{"slug": o.slug}, "everything": o.all}
		ok = daemon.call(context.Background(), o.verb, body, &reply) == nil
	}
	if !ok {
		reply = map[string]any{"running": false}
	}
	limitMB := browserMemoryMB()
	killMB := int(domain.BrowserKillRSS(limitMB) >> 20)
	if o.verb == "status" {
		reply["governorKillMb"] = killMB
		if _, has := reply["limitMb"]; !has {
			reply["limitMb"] = limitMB
		}
	}
	if o.asJSON {
		return json.NewEncoder(os.Stdout).Encode(reply)
	}
	switch {
	case !ok:
		fmt.Println("no browser running on this machine")
		fmt.Println(browserMemory{usedMB: -1, limitMB: limitMB, killAboveMB: killMB}.line())
	case o.verb == "stop" && reply["stopped"] == true:
		fmt.Println("browser stopped")
	case o.verb == "stop":
		fmt.Printf("closed this stack's lanes %v; the browser exits once no lane is left\n", reply["closed"])
	default:
		fmt.Printf("browser pid %d (machine-wide), this stack's lanes %v, every lane %v\n", daemon.PID, reply["lanes"], reply["all"])
		memoryMB, _ := reply["memoryMb"].(float64)
		unloadMB, _ := reply["unloadAboveMb"].(float64)
		fmt.Println(browserMemory{usedMB: int(memoryMB), limitMB: daemonLimitMB(reply, limitMB), unloadAboveMB: int(unloadMB), killAboveMB: killMB}.line())
	}
	return nil
}

// daemonLimitMB is the limit the running daemon was started with, else haven's own.
func daemonLimitMB(reply map[string]any, fallback int) int {
	if n, ok := reply["limitMb"].(float64); ok && n > 0 {
		return int(n)
	}
	return fallback
}

// browserMemory is status's memory line: use against the one limit, where the
// daemon unloads pages (0 when an older daemon does not say) and where haven's
// governor kills (from haven's own limit). usedMB below zero: no browser running.
type browserMemory struct{ usedMB, limitMB, unloadAboveMB, killAboveMB int }

func (m browserMemory) line() string {
	if m.usedMB < 0 {
		return fmt.Sprintf("memory limit %d MB (%s); haven kills the browser above %d MB", m.limitMB, domain.LimitBrowserMemory, m.killAboveMB)
	}
	unload := ""
	if m.unloadAboveMB > 0 {
		unload = fmt.Sprintf("idle pages unload above %d MB, ", m.unloadAboveMB)
	}
	return fmt.Sprintf("memory %d MB of the %d MB limit (%s): %snew lanes are refused above the limit, haven kills the browser above %d MB",
		m.usedMB, m.limitMB, domain.LimitBrowserMemory, unload, m.killAboveMB)
}

// stopBrowser closes slug's lanes in the machine's browser; `haven down` calls it.
func stopBrowser(slug string) {
	if daemon, ok := runningBrowser(slug); ok {
		_ = daemon.call(context.Background(), "stop", map[string]any{"stack": map[string]any{"slug": slug}}, nil)
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

// ensureBrowser returns the machine's running daemon, starting one under a lock so
// lanes arriving together, from any stack, share a single browser, plus the stack
// fields every request carries (the daemon serves every stack).
func ensureBrowser(ctx context.Context, t browserTarget) (browserDaemon, map[string]any, error) {
	d, slug := t.d, t.slug
	stack, err := browserStack(d, t.inv, slug)
	if err != nil {
		return browserDaemon{}, nil, err
	}
	dir, home := browserDir(slug), browserHomeFor(d.worktree, slug)
	lock, err := os.OpenFile(filepath.Join(home, "daemon.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return browserDaemon{}, nil, err
	}
	defer func() { _ = lock.Close() }()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return browserDaemon{}, nil, err
	}
	if daemon, ok, err := reusableBrowser(ctx, home, home == dir); ok || err != nil {
		return daemon, stack, err
	}
	legacy := []string{"HAVEN_BROWSER_DIR=" + dir, "HAVEN_BROWSER_STACK=" + slug, "HAVEN_BROWSER_APP=" + fmt.Sprint(stack["app"]), "HAVEN_BROWSER_HAVEN=" + fmt.Sprint(stack["haven"]), "HAVEN_BROWSER_APP_LOG=" + fmt.Sprint(stack["appLog"])}
	daemon, err := startBrowser(ctx, browserStart{dir: home, worktree: d.worktree, legacyEnv: legacy})
	return daemon, stack, err
}

// browserTarget is the stack a browser call drives, and the invocation naming it.
type browserTarget struct {
	d    deps
	inv  invocation
	slug string
}

// browserStack is the stack fields a request carries, with the stack's browser
// directories made; it refuses a worktree with no running stack.
func browserStack(d deps, inv invocation, slug string) (map[string]any, error) {
	dir, home := browserDir(slug), browserHomeFor(d.worktree, slug)
	appURL := telemetryOverlayValue(telemetryOverlay(d, inv), "LANGWATCH_ENDPOINT")
	appLog := appLogPath(d.orch.LogDir(slug))
	if appURL == "" {
		// `haven up --only docs`: no app to wait on, so the docs host stands in for it.
		appURL, appLog = d.orch.DocsOnlyURL(authParams(d, inv)), ""
	}
	if appURL == "" {
		return nil, errors.New("this worktree has no running stack; run haven up --agent -d (or haven up --only docs)")
	}
	if _, err := localApp(appURL); err != nil {
		return nil, err
	}
	self, err := os.Executable()
	if err != nil {
		return nil, err
	}
	for _, path := range []string{dir, home} {
		if err := os.MkdirAll(path, 0o700); err != nil {
			return nil, err
		}
	}
	return map[string]any{"slug": slug, "app": appURL, "appLog": appLog, "dir": dir, "haven": self}, nil
}

// reusableBrowser is the running daemon under home when it speaks this protocol (a
// legacy per-stack daemon always is); an idle one on another protocol is retired.
func reusableBrowser(ctx context.Context, home string, legacy bool) (browserDaemon, bool, error) {
	daemon, ok := readBrowserDaemon(home)
	if !ok || legacy {
		return daemon, ok, nil
	}
	if err := currentProtocol(ctx, daemon); err != nil {
		return daemon, false, err
	}
	return daemon, daemon.Protocol == browserProtocol, nil
}

// currentProtocol retires an idle daemon speaking another protocol so a fresh one
// starts; a busy one is left to its lanes and the caller is told how to replace it.
func currentProtocol(ctx context.Context, daemon browserDaemon) error {
	if daemon.Protocol == browserProtocol {
		return nil
	}
	var status struct {
		Lanes []string `json:"lanes"`
	}
	if daemon.call(ctx, "status", map[string]any{}, &status) == nil && len(status.Lanes) > 0 {
		return fmt.Errorf("the machine's browser (pid %d) runs another haven's protocol with lanes %v open; haven browser stop --all, then retry", daemon.PID, status.Lanes)
	}
	_ = daemon.call(ctx, "stop", map[string]any{}, nil)
	for i := 0; i < 50 && syscall.Kill(daemon.PID, 0) == nil; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	return nil
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
	dir, worktree string
	// legacyEnv is what a daemon script older than the shared browser needs to start.
	legacyEnv []string
}

func startBrowser(ctx context.Context, s browserStart) (browserDaemon, error) {
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
	child.Env = append(append(os.Environ(), "HAVEN_BROWSER_TOKEN="+daemon.Token,
		fmt.Sprintf("%s=%d", domain.BrowserMemoryEnv, browserMemoryMB())), s.legacyEnv...)
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
	hello, err := browserFirstLine(ctx, stdout)
	if err != nil {
		_ = child.Process.Kill()
		return daemon, fmt.Errorf("the browser did not start: %w — see %s", err, filepath.Join(s.dir, "daemon.log"))
	}
	daemon.Port, daemon.Protocol = hello.Port, hello.Protocol
	_ = child.Process.Release()
	data, _ := json.Marshal(daemon)
	return daemon, atomicfile.Write(filepath.Join(s.dir, "daemon.json"), data, 0o600)
}

// browserHello is the daemon's one stdout line, the event that says it listens.
type browserHello struct {
	Port     int `json:"port"`
	Protocol int `json:"protocol"`
}

// browserFirstLine waits for the daemon's {"port":N,"protocol":P} line.
func browserFirstLine(ctx context.Context, stdout io.Reader) (browserHello, error) {
	type first struct {
		hello browserHello
		err   error
	}
	done := make(chan first, 1)
	go func() {
		line, err := bufio.NewReader(stdout).ReadBytes('\n')
		var hello browserHello
		if err == nil {
			err = json.Unmarshal(line, &hello)
		}
		done <- first{hello, err}
	}()
	select {
	case got := <-done:
		if got.err == nil && got.hello.Port == 0 {
			got.err = errors.New("no port in its first line")
		}
		return got.hello, got.err
	case <-ctx.Done():
		return browserHello{}, ctx.Err()
	case <-time.After(browserStartTimeout):
		return browserHello{}, fmt.Errorf("no answer within %s", browserStartTimeout)
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

// uploadFiles checks given[1:] are existing files under the repo's .claude/tmp/ and returns them absolute.
func uploadFiles(given []string) ([]string, error) {
	if len(given) < 2 {
		return nil, errors.New("haven browser upload needs <ref> and at least one <file>")
	}
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	root := cwd
	for {
		if _, err := os.Stat(filepath.Join(root, ".git")); err == nil {
			break
		}
		if parent := filepath.Dir(root); parent != root {
			root = parent
			continue
		}
		return nil, errors.New("haven browser upload must run inside the repository")
	}
	allowed := filepath.Join(root, ".claude", "tmp") + string(filepath.Separator)
	files := make([]string, 0, len(given)-1)
	for _, raw := range given[1:] {
		abs, err := filepath.Abs(raw)
		if err != nil {
			return nil, err
		}
		if !strings.HasPrefix(abs, allowed) {
			return nil, fmt.Errorf("haven browser upload only reads files under %s (got %s)", allowed, abs)
		}
		if info, err := os.Stat(abs); err != nil || info.IsDir() {
			return nil, fmt.Errorf("haven browser upload: %s is not an existing file", abs)
		}
		files = append(files, abs)
	}
	return files, nil
}
