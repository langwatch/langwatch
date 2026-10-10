package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven api` calls this stack's REST API with the seeded project key, so a
// walking agent can make a keyed call without ever seeing the key: haven reads
// it from the overlay (as `haven telemetry` does) and scrubs it from the output.

const apiHTTPTimeout = 60 * time.Second

// apiKeyName names the key `whoami` reports: the seeded project's own key.
const apiKeyName = "seeded project key (HAVEN_SEED_LANGWATCH_API_KEY)"

const redacted = "<redacted>"

// apiSecretHeaders are response headers whose values never print.
var apiSecretHeaders = []string{"Authorization", "Set-Cookie", "X-Auth-Token", "Proxy-Authorization"}

func apiSpec() commandSpec {
	return commandSpec{
		name:    "api",
		summary: "call this stack's REST API with the seeded project key, which is never printed: <METHOD> <path> | whoami",
		args:    "<METHOD> <path> | whoami",
		maxArgs: 2,
		flags: []flagSpec{
			{long: "--project", takesValue: true, value: "<slug>", summary: "the project to call as (only the seeded " + domain.DefaultProjectSlug + " has a key haven holds)"},
			{long: "--body", takesValue: true, value: "<file>|-", summary: "request body from a file, or - for stdin (Content-Type defaults to application/json)"},
			{long: "--header", takesValue: true, value: "<k:v>", summary: "an extra request header (repeatable)"},
			{long: "--json", summary: "one JSON object: status, headers, body"},
			{long: "--stack", takesValue: true, value: "<slug>", summary: "another worktree's stack by slug"},
		},
		run: runAPI,
	}
}

// apiResult is what `haven api` prints, with every secret already scrubbed.
type apiResult struct {
	Status  int               `json:"status"`
	Line    string            `json:"statusLine"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body,omitempty"`
	Text    string            `json:"text,omitempty"`
}

func runAPI(ctx context.Context, d deps, inv invocation) error {
	usage := errors.New("usage: haven api <METHOD> <path> [--project slug] [--body file|-] [--header k:v] [--json] | haven api whoami")
	if project := inv.value("--project"); project != "" && project != domain.DefaultProjectSlug {
		return fmt.Errorf("haven api: haven holds a key only for the seeded project %q, not %q", domain.DefaultProjectSlug, project)
	}
	overlay := telemetryOverlay(d, inv)
	base, key := telemetryOverlayValue(overlay, "LANGWATCH_API_URL"), telemetryOverlayValue(overlay, "HAVEN_SEED_LANGWATCH_API_KEY")
	if base == "" || key == "" {
		return errors.New("haven api: this worktree has no running stack with a seeded key; run haven up --agent -d")
	}
	switch {
	case len(inv.args) == 1 && inv.args[0] == "whoami":
		return printWhoami(inv.has("--json") || d.isAgent)
	case len(inv.args) > 0 && inv.args[0] == "key":
		return errors.New("haven api key rotate: the seeded key is shared by every stack on this machine; reseed with LANGWATCH_LOCAL_API_KEY set to change it")
	case len(inv.args) != 2:
		return usage
	}
	body, err := apiBody(inv.value("--body"))
	if err != nil {
		return err
	}
	res, err := callAPI(ctx, apiCall{
		base: base, key: key, method: strings.ToUpper(inv.args[0]), path: inv.args[1],
		headers: repeatedValues(inv.raw, "--header"), body: body,
	})
	if err != nil {
		return err
	}
	return printAPIResult(os.Stdout, res, inv.has("--json") || d.isAgent)
}

func printWhoami(asJSON bool) error {
	if asJSON {
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"project": domain.DefaultProjectSlug, "key": apiKeyName})
	}
	fmt.Printf("project  %s\nkey      %s\n", domain.DefaultProjectSlug, apiKeyName)
	return nil
}

func apiBody(from string) ([]byte, error) {
	switch from {
	case "":
		return nil, nil
	case "-":
		return io.ReadAll(os.Stdin)
	}
	return os.ReadFile(from)
}

// repeatedValues is every value of a repeatable flag; parsed flags keep only the last.
func repeatedValues(raw []string, long string) []string {
	var values []string
	for i, arg := range raw {
		if value, ok := strings.CutPrefix(arg, long+"="); ok {
			values = append(values, value)
		} else if arg == long && i+1 < len(raw) {
			values = append(values, raw[i+1])
		}
	}
	return values
}

type apiCall struct {
	base, key, method, path string
	headers                 []string
	body                    []byte
}

// callAPI makes c against this machine's API only, and returns the response scrubbed of c.key.
func callAPI(ctx context.Context, c apiCall) (apiResult, error) {
	if !strings.HasPrefix(c.path, "/") {
		return apiResult{}, fmt.Errorf("haven api: path %q must start with /", c.path)
	}
	base, err := localApp(c.base)
	if err != nil {
		return apiResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, c.method, base.String()+c.path, bytes.NewReader(c.body))
	if err != nil {
		return apiResult{}, fmt.Errorf("haven api: %w", err)
	}
	for _, h := range c.headers {
		k, v, ok := strings.Cut(h, ":")
		if !ok {
			return apiResult{}, fmt.Errorf("haven api: header %q is not k:v", h)
		}
		req.Header.Set(strings.TrimSpace(k), strings.TrimSpace(v))
	}
	if len(c.body) > 0 && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Auth-Token", c.key)
	resp, err := (&http.Client{Timeout: apiHTTPTimeout}).Do(req)
	if err != nil {
		return apiResult{}, errors.New(scrub(fmt.Sprintf("haven api: %v", err), c.key))
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return apiResult{}, fmt.Errorf("haven api: reading the response: %w", err)
	}
	return scrubbedResult(resp, raw, c.key), nil
}

func scrubbedResult(resp *http.Response, raw []byte, key string) apiResult {
	res := apiResult{Status: resp.StatusCode, Line: resp.Proto + " " + resp.Status, Headers: map[string]string{}}
	for name, values := range resp.Header {
		value := strings.Join(values, ", ")
		if slices.ContainsFunc(apiSecretHeaders, func(s string) bool { return strings.EqualFold(s, name) }) {
			value = redacted
		}
		res.Headers[name] = scrub(value, key)
	}
	body := scrub(string(raw), key)
	if json.Valid([]byte(body)) {
		res.Body = json.RawMessage(body)
	} else {
		res.Text = body
	}
	return res
}

func scrub(s, key string) string {
	if key == "" {
		return s
	}
	return strings.ReplaceAll(s, key, redacted)
}

func printAPIResult(w io.Writer, res apiResult, asJSON bool) error {
	if asJSON {
		return json.NewEncoder(w).Encode(res)
	}
	fmt.Fprintln(w, res.Line)
	names := make([]string, 0, len(res.Headers))
	for name := range res.Headers {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		fmt.Fprintf(w, "%s: %s\n", name, res.Headers[name])
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, string(res.Body)+res.Text)
	return nil
}
