// Package browser keeps scenario runs in one LangWatch browser tab instead
// of opening a new one per run, in three layers tried in order:
//
//  1. Handoff: LangWatch knows whether a simulations tab opened by this
//     machine is still connected; if one is, the run is pushed to it.
//  2. Throttle: when LangWatch cannot answer, an on-disk record keeps repeat
//     runs of one set from opening another tab within a short window.
//  3. Policy: SCENARIO_BROWSER (auto, never, always), the headless setting
//     and CI decide whether a browser may open at all.
//
// The state files are shared byte for byte with the JS and Python SDKs.
// Every step fails open: nothing here may disturb the run itself.
package browser

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	// TabQueryParam carries this machine's tab key into the opened page.
	TabQueryParam = "scenarioTab"
	// HandoffTimeout bounds the handoff request.
	HandoffTimeout = 2 * time.Second
	// DefaultReopenInterval is the throttle window, used only when
	// LangWatch cannot answer the handoff.
	DefaultReopenInterval = 300 * time.Second
)

// Policy decides whether a browser may be opened.
type Policy string

// Policies.
const (
	PolicyAuto   Policy = "auto"
	PolicyNever  Policy = "never"
	PolicyAlways Policy = "always"
)

// Outcome is what Show did.
type Outcome string

// Outcomes.
const (
	HandedOff            Outcome = "handed_off"
	Opened               Outcome = "opened"
	SuppressedByPolicy   Outcome = "suppressed_by_policy"
	SuppressedByThrottle Outcome = "suppressed_by_throttle"
	FailedToOpen         Outcome = "failed_to_open"
)

// Location is the live view of a batch run.
type Location struct {
	BatchURL      string
	BatchRunID    string
	ScenarioSetID string
}

// Options configure Show.
type Options struct {
	Headless  bool
	Endpoint  string
	APIKey    string
	ProjectID string
	// Opener opens a URL; defaults to the platform's browser launcher.
	Opener func(url string) error
	// HTTPClient sends the handoff request; defaults to http.DefaultClient.
	HTTPClient *http.Client
	// Debug logs fail-open errors; may be nil.
	Debug func(msg string, args ...any)
	// Warn logs configuration mistakes; may be nil.
	Warn func(msg string, args ...any)
}

func (o *Options) debug(msg string, args ...any) {
	if o.Debug != nil {
		o.Debug(msg, args...)
	}
}

func (o *Options) warn(msg string, args ...any) {
	if o.Warn != nil {
		o.Warn(msg, args...)
	}
}

func stateDir() string {
	if d := os.Getenv("LANGWATCH_STATE_DIR"); d != "" {
		return d
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".langwatch")
}

func isTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "", "0", "false", "no":
		return false
	}
	return true
}

// ResolvePolicy decides the opening policy. An explicit SCENARIO_BROWSER
// wins, even over headless; otherwise headless and CI mean never.
func ResolvePolicy(headless bool, warn func(string, ...any)) Policy {
	switch raw := strings.ToLower(strings.TrimSpace(os.Getenv("SCENARIO_BROWSER"))); raw {
	case "auto", "never", "always":
		return Policy(raw)
	case "":
	default:
		if warn != nil {
			warn("Unrecognized SCENARIO_BROWSER=" + raw + ", expected one of auto/never/always; falling back to auto")
		}
		return PolicyAuto
	}
	if headless || isTruthy(os.Getenv("CI")) {
		return PolicyNever
	}
	return PolicyAuto
}

// TabKey is this machine's stable scenario tab id, created on first use; ""
// when the state directory is unusable, which only disables reuse.
func TabKey() string {
	dir := stateDir()
	if dir == "" {
		return ""
	}
	path := filepath.Join(dir, "scenario-tab-key")
	if b, err := os.ReadFile(path); err == nil {
		if k := strings.TrimSpace(string(b)); k != "" {
			return k
		}
	}
	var raw [16]byte
	_, _ = rand.Read(raw[:])
	key := hex.EncodeToString(raw[:])
	if err := os.MkdirAll(dir, 0o755); err == nil {
		// Exclusive create: of two processes starting at once, the loser
		// reads the winner's key.
		if f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644); err == nil {
			_, werr := f.WriteString(key)
			if cerr := f.Close(); werr == nil && cerr == nil {
				return key
			}
		}
	}
	if b, err := os.ReadFile(path); err == nil {
		return strings.TrimSpace(string(b))
	}
	return ""
}

func reopenInterval(o *Options) time.Duration {
	raw := os.Getenv("SCENARIO_BROWSER_REOPEN_SECONDS")
	if raw == "" {
		return DefaultReopenInterval
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		o.warn("Ignoring non-numeric SCENARIO_BROWSER_REOPEN_SECONDS=" + raw)
		return DefaultReopenInterval
	}
	return time.Duration(max(0, n)) * time.Second
}

// throttlePath is the throttle record, or "" when there is no state
// directory: the record must never land in the working directory.
func throttlePath() string {
	dir := stateDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, "scenario-tab-opens.json")
}

func readThrottle() map[string]float64 {
	out := map[string]float64{}
	path := throttlePath()
	if path == "" {
		return out
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	var raw map[string]any
	if json.Unmarshal(b, &raw) != nil {
		return out
	}
	for k, v := range raw {
		if f, ok := v.(float64); ok {
			out[k] = f
		}
	}
	return out
}

func openedRecently(o *Options, setKey string, now float64) bool {
	interval := reopenInterval(o).Seconds()
	if interval <= 0 {
		return false
	}
	last, ok := readThrottle()[setKey]
	return ok && now-last < interval
}

func recordOpen(o *Options, setKey string, now float64) {
	target := throttlePath()
	if target == "" {
		return
	}
	entries := readThrottle()
	entries[setKey] = now
	horizon := max(reopenInterval(o).Seconds(), 1) * 10
	for k, seen := range entries {
		if now-seen >= horizon {
			delete(entries, k)
		}
	}
	tmp := target + "." + strconv.Itoa(os.Getpid()) + ".tmp"
	b, _ := json.Marshal(entries)
	err := os.MkdirAll(filepath.Dir(target), 0o755)
	if err == nil {
		err = os.WriteFile(tmp, b, 0o644)
	}
	if err == nil {
		err = os.Rename(tmp, target)
	}
	if err != nil {
		o.debug("Could not record the browser open time", "error", err.Error())
	}
}

func withTabKey(raw, key string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return raw
	}
	q := u.Query()
	q.Set(TabQueryParam, key)
	u.RawQuery = q.Encode()
	return u.String()
}

// handoff asks LangWatch to push the batch to an open tab: true when a tab
// took it, false when none listens, and an error when LangWatch cannot
// answer, so the caller falls back to its own heuristics.
func handoff(ctx context.Context, o *Options, key string, loc Location) (bool, error) {
	body := map[string]string{"tabKey": key, "batchRunId": loc.BatchRunID}
	if loc.ScenarioSetID != "" {
		body["scenarioSetId"] = loc.ScenarioSetID
	}
	payload, _ := json.Marshal(body)
	base, err := url.Parse(o.Endpoint)
	if err != nil {
		return false, err
	}
	target := base.ResolveReference(&url.URL{Path: "/api/scenario-events/browser-tab"}).String()
	ctx, cancel := context.WithTimeout(ctx, HandoffTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(payload))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+o.APIKey)
	if o.ProjectID != "" {
		req.Header.Set("X-Project-Id", o.ProjectID)
	}
	client := o.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return false, errors.New("browser tab handoff returned " + strconv.Itoa(resp.StatusCode))
	}
	var data struct {
		Delivered bool `json:"delivered"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return false, err
	}
	return data.Delivered, nil
}

// Show puts the batch run in front of the user, reusing their tab when
// possible.
func Show(ctx context.Context, loc Location, o Options) Outcome {
	policy := ResolvePolicy(o.Headless, o.Warn)
	if policy == PolicyNever {
		return SuppressedByPolicy
	}
	key := TabKey()
	if policy == PolicyAuto && key != "" && o.Endpoint != "" && o.APIKey != "" {
		delivered, err := handoff(ctx, &o, key, loc)
		switch {
		case err != nil:
			o.debug("Browser tab handoff request failed", "error", err.Error())
		case delivered:
			return HandedOff
		default:
			// Authoritative "no tab is listening": open one, skipping the
			// throttle that only exists for servers that cannot answer.
			return openTab(&o, loc, key, "", 0)
		}
	}
	now := float64(time.Now().UnixMilli()) / 1000
	setKey := loc.ScenarioSetID
	if setKey == "" {
		setKey = loc.BatchURL
	}
	if policy == PolicyAuto && openedRecently(&o, setKey, now) {
		return SuppressedByThrottle
	}
	return openTab(&o, loc, key, setKey, now)
}

func openTab(o *Options, loc Location, key, setKey string, now float64) Outcome {
	target := loc.BatchURL
	if key != "" {
		target = withTabKey(target, key)
	}
	opener := o.Opener
	if opener == nil {
		opener = openURL
	}
	if err := opener(target); err != nil {
		o.debug("Could not open a browser", "error", err.Error())
		return FailedToOpen
	}
	if setKey != "" {
		recordOpen(o, setKey, now)
	}
	return Opened
}

// openURL starts the platform's URL launcher and reaps it in the background.
func openURL(u string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", u)
	case "linux":
		cmd = exec.Command("xdg-open", u)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", u)
	default:
		return errors.New("no browser launcher for " + runtime.GOOS)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
