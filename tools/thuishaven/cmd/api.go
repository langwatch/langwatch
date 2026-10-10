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
)

// `haven api` calls this stack's REST API with a key haven holds, so a walking
// agent can make a keyed call without ever seeing it: the seeded project key by
// default, or `--key org|personal` and `--project` (apikeys.go). Every key haven
// knows is scrubbed from the output.

const apiHTTPTimeout = 60 * time.Second

const redacted = "<redacted>"

// apiSecretHeaders are response headers whose values never print.
var apiSecretHeaders = []string{"Authorization", "Set-Cookie", "X-Auth-Token", "Proxy-Authorization"}

func apiSpec() commandSpec {
	return commandSpec{
		name:    "api",
		summary: "call this stack's REST API with a key haven holds, which is never printed: <METHOD> <path> | whoami",
		args:    "<METHOD> <path> | whoami",
		maxArgs: 2,
		flags: []flagSpec{
			{long: "--key", takesValue: true, value: "<kind>", summary: "project (default, the seeded key), org (a service key haven mints) or personal (the seeded admin's token)"},
			{long: "--project", takesValue: true, value: "<slug>", summary: "another project: --key project mints a key bound to it; org and personal send its X-Project-Id"},
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
	// raw is the unscrubbed body, for haven's own minting calls only; it never prints.
	raw []byte
}

func runAPI(ctx context.Context, d deps, inv invocation) error {
	usage := errors.New("usage: haven api <METHOD> <path> [--key project|org|personal] [--project slug] [--body file|-] [--header k:v] [--json] | haven api whoami")
	ring, err := stackKeyring(d, inv)
	if err != nil {
		return err
	}
	kind, project := inv.value("--key"), inv.value("--project")
	switch {
	case len(inv.args) == 1 && inv.args[0] == "whoami":
		key, err := ring.resolve(ctx, kind, project)
		if err != nil {
			return fmt.Errorf("haven api: %w", err)
		}
		return printWhoami(os.Stdout, key, inv.has("--json") || d.isAgent)
	case len(inv.args) > 0 && inv.args[0] == "key":
		return errors.New("haven api key rotate: the seeded key is shared by every stack on this machine; reseed with LANGWATCH_LOCAL_API_KEY set to change it")
	case len(inv.args) != 2:
		return usage
	}
	body, err := apiBody(inv.value("--body"))
	if err != nil {
		return err
	}
	res, err := ring.call(ctx, kind, project, func(key resolvedKey) apiCall {
		return apiCall{
			base: ring.api, key: key.secret, method: strings.ToUpper(inv.args[0]), path: inv.args[1],
			headers: append(key.headers, repeatedValues(inv.raw, "--header")...), body: body,
		}
	})
	if err != nil {
		return err
	}
	return printAPIResult(os.Stdout, res, inv.has("--json") || d.isAgent)
}

// stackKeyring is the keyring of the stack this invocation names.
func stackKeyring(d deps, inv invocation) (keyring, error) {
	overlay := telemetryOverlay(d, inv)
	ring := keyring{
		api:      telemetryOverlayValue(overlay, "LANGWATCH_API_URL"),
		seeded:   telemetryOverlayValue(overlay, "HAVEN_SEED_LANGWATCH_API_KEY"),
		personal: telemetryOverlayValue(overlay, "LANGWATCH_PRIVATE_ACCESS_TOKEN"),
	}
	if ring.api == "" || d.orch == nil {
		return keyring{}, errors.New("haven api: this worktree has no running stack; run haven up --agent -d")
	}
	slug, err := d.orch.ResolveSlug(authParams(d, inv))
	if err != nil {
		return keyring{}, err
	}
	ring.file = keyringFile(slug)
	return ring, nil
}

// call resolves the key, makes the call, and on a 401 with a held key mints a
// fresh one once: the stack was reseeded or reset since haven minted it.
func (k keyring) call(ctx context.Context, kind, project string, build func(resolvedKey) apiCall) (apiResult, error) {
	for attempt := 0; ; attempt++ {
		key, err := k.resolve(ctx, kind, project)
		if err != nil {
			return apiResult{}, fmt.Errorf("haven: %w", err)
		}
		c := build(key)
		c.scrubs = k.secrets()
		res, err := callAPI(ctx, c)
		if err != nil || res.Status != http.StatusUnauthorized || key.minted == "" || attempt > 0 {
			return res, err
		}
		if err := k.forget(key.minted); err != nil {
			return apiResult{}, err
		}
	}
}

func printWhoami(w io.Writer, key resolvedKey, asJSON bool) error {
	if asJSON {
		return json.NewEncoder(w).Encode(map[string]string{"principal": key.principal, "scope": key.scope})
	}
	_, err := fmt.Fprintf(w, "principal  %s\nscope      %s\n", key.principal, key.scope)
	return err
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
	bearer                  bool     // send the key as Authorization: Bearer, not X-Auth-Token
	scrubs                  []string // further secrets the output must never carry
}

// callAPI makes c against this machine's API only, and returns the response scrubbed of c.key.
func callAPI(ctx context.Context, c apiCall) (apiResult, error) {
	if !strings.HasPrefix(c.path, "/") {
		return apiResult{}, fmt.Errorf("haven: path %q must start with /", c.path)
	}
	base, err := localApp(c.base)
	if err != nil {
		return apiResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, c.method, base.String()+c.path, bytes.NewReader(c.body))
	if err != nil {
		return apiResult{}, fmt.Errorf("haven: %w", err)
	}
	for _, h := range c.headers {
		k, v, ok := strings.Cut(h, ":")
		if !ok {
			return apiResult{}, fmt.Errorf("haven: header %q is not k:v", h)
		}
		req.Header.Set(strings.TrimSpace(k), strings.TrimSpace(v))
	}
	if len(c.body) > 0 && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.bearer {
		req.Header.Set("Authorization", "Bearer "+c.key)
	} else {
		req.Header.Set("X-Auth-Token", c.key)
	}
	secrets := append([]string{c.key}, c.scrubs...)
	resp, err := (&http.Client{Timeout: apiHTTPTimeout}).Do(req)
	if err != nil {
		return apiResult{}, errors.New(scrub(fmt.Sprintf("haven: %v", err), secrets...))
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return apiResult{}, fmt.Errorf("haven: reading the response: %w", err)
	}
	return scrubbedResult(resp, raw, secrets...), nil
}

func scrubbedResult(resp *http.Response, raw []byte, secrets ...string) apiResult {
	res := apiResult{Status: resp.StatusCode, Line: resp.Proto + " " + resp.Status, Headers: map[string]string{}, raw: raw}
	for name, values := range resp.Header {
		value := strings.Join(values, ", ")
		if slices.ContainsFunc(apiSecretHeaders, func(s string) bool { return strings.EqualFold(s, name) }) {
			value = redacted
		}
		res.Headers[name] = scrub(value, secrets...)
	}
	body := scrub(string(raw), secrets...)
	if json.Valid([]byte(body)) {
		res.Body = json.RawMessage(body)
	} else {
		res.Text = body
	}
	return res
}

func scrub(s string, secrets ...string) string {
	for _, secret := range secrets {
		if secret != "" {
			s = strings.ReplaceAll(s, secret, redacted)
		}
	}
	return s
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
