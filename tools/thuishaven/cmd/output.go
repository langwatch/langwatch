package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer"
)

// The output contract (ADR-064, amendment 2026-10-10): every --json output is
// one object {"v":1,...} naming the stack it read; --json a,b keeps those
// fields; bare --json on a command with fields lists them. Streams are NDJSON
// and are never enveloped. Enveloping here, at dispatch, keeps every command's
// own printer as it is.

const outputVersion = 1

var fieldList = regexp.MustCompile(`^[A-Za-z][\w-]*(,[A-Za-z][\w-]*)*$`)

// jsonSelection is what the caller asked of --json: nothing, a field list, or
// (on a command with fields) the list of fields itself.
type jsonSelection struct {
	fields     []string
	listFields bool
}

// takeJSONSelection reads `--json=a,b`, or `--json a,b` on a command with
// fields, and leaves a plain --json for the command's own parser.
func takeJSONSelection(spec commandSpec, rest []string) ([]string, jsonSelection, error) {
	var sel jsonSelection
	out := make([]string, 0, len(rest))
	sawJSON := false
	for i := 0; i < len(rest); i++ {
		a := rest[i]
		if a == "--" {
			out = append(out, rest[i:]...)
			break
		}
		if v, ok := strings.CutPrefix(a, "--json="); ok {
			if !fieldList.MatchString(v) {
				return nil, sel, usageErr("--json=%s is not a comma-separated field list", v)
			}
			sel.fields, sawJSON = strings.Split(v, ","), true
			out = append(out, "--json")
			continue
		}
		if a == "--json" {
			sawJSON = true
			if spec.fields && i+1 < len(rest) && fieldList.MatchString(rest[i+1]) {
				sel.fields = strings.Split(rest[i+1], ",")
				i++
			}
		}
		out = append(out, a)
	}
	sel.listFields = sawJSON && spec.fields && sel.fields == nil
	return out, sel, nil
}

// envelope runs a --json command with its stdout captured, then prints its
// output as the versioned object.
func (d deps) envelope(spec commandSpec, sel jsonSelection, run func() error) error {
	raw, err := captureOutput(run)
	if err != nil {
		os.Stdout.Write(raw) //nolint:errcheck // the command's own output, passed on as it failed
		return err
	}
	obj, ok := envelopeOf(raw, d.resolvedStack())
	if !ok {
		_, werr := os.Stdout.Write(raw)
		return werr
	}
	if sel.listFields {
		return usageErr("haven %s --json takes the fields to print, comma separated:\n  %s", spec.display(), strings.Join(fieldNames(obj), "\n  "))
	}
	if sel.fields != nil {
		if obj, err = selectFields(obj, sel.fields); err != nil {
			return err
		}
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(obj)
}

// envelopeOf wraps one JSON value as the versioned object: an object gains
// "v" and "stack", anything else sits under "items". Output that is not a
// single JSON value (text, NDJSON) is not enveloped.
func envelopeOf(raw []byte, stack string) (map[string]any, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var value any
	if dec.Decode(&value) != nil {
		return nil, false
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, false
	}
	obj, isObject := value.(map[string]any)
	if !isObject {
		obj = map[string]any{"items": value}
	}
	obj["v"] = outputVersion
	if stack != "" {
		obj["stack"] = stack
	}
	return obj, true
}

func fieldNames(obj map[string]any) []string {
	var names []string
	for k := range obj {
		if k != "v" && k != "stack" {
			names = append(names, k)
		}
	}
	sort.Strings(names)
	return names
}

func selectFields(obj map[string]any, fields []string) (map[string]any, error) {
	out := map[string]any{"v": obj["v"]}
	if s, ok := obj["stack"]; ok {
		out["stack"] = s
	}
	for _, f := range fields {
		v, ok := obj[f]
		if !ok && f != "v" && f != "stack" {
			return nil, usageErr("no field %q; the fields are: %s", f, strings.Join(fieldNames(obj), ", "))
		}
		if ok {
			out[f] = v
		}
	}
	return out, nil
}

// captureOutput runs fn with os.Stdout pointed at a pipe and returns what it
// printed.
func captureOutput(fn func() error) ([]byte, error) {
	r, w, err := os.Pipe()
	if err != nil {
		return nil, fn()
	}
	orig := os.Stdout
	os.Stdout = w
	done := make(chan []byte)
	go func() {
		b, _ := io.ReadAll(r)
		done <- b
	}()
	runErr := fn()
	_ = w.Close()
	os.Stdout = orig
	out := <-done
	_ = r.Close()
	return out, runErr
}

// resolvedStack is the slug the command ran against, for structured output.
func (d deps) resolvedStack() string {
	if d.target != "" {
		return d.target
	}
	if d.orch == nil || d.worktree == "" {
		return ""
	}
	slug, err := d.orch.ResolveSlug(d.params)
	if err != nil {
		return ""
	}
	return slug
}

// runStatus is `haven status`: the one-shot report, then this stack's jobs
// and stores, which used to be commands of their own.
func runStatus(_ context.Context, d deps, inv invocation) error {
	asJSON := d.isAgent || inv.has("--json")
	slug := d.resolvedStack()
	if !asJSON {
		if err := d.orch.Status(false, d.worktree, inv.has("--reveal")); err != nil {
			return err
		}
		for _, name := range []string{"jobs", "stores"} {
			if body, ok := statusTabBody(d, slug, name); ok {
				fmt.Printf("\n%s\n%s", name, body)
			}
		}
		return nil
	}
	raw, err := captureOutput(func() error { return d.orch.Status(true, d.worktree, inv.has("--reveal")) })
	if err != nil {
		return err
	}
	var report map[string]any
	if err := json.Unmarshal(raw, &report); err != nil {
		_, werr := os.Stdout.Write(raw)
		return werr
	}
	for _, name := range []string{"jobs", "stores"} {
		report[name] = statusTabRows(d, slug, name)
	}
	return json.NewEncoder(os.Stdout).Encode(report)
}

// statusTab is one viewer tab for this stack, polled once, as the tab commands read it.
func statusTab(d deps, slug, name string) (viewer.Tab, bool) {
	if slug == "" {
		return nil, false
	}
	m := newViewerModel(slug, d.orch.LogPath(slug), d.orch.LogDir(slug))
	m.enableDashboard(d.sessionActions(slug), false)
	m.ingest()
	tab, ok := m.tabs[name]
	if ok {
		tab.Poll()
	}
	return tab, ok
}

func statusTabRows(d deps, slug, name string) any {
	if tab, ok := statusTab(d, slug, name); ok {
		return tab.Rows()
	}
	return []any{}
}

func statusTabBody(d deps, slug, name string) (string, bool) {
	tab, ok := statusTab(d, slug, name)
	if !ok {
		return "", false
	}
	raw, _ := captureOutput(func() error { printTabBody(tab); return nil })
	return string(raw), true
}

// runDBStatus is `haven db status`: the connection URLs and the last seed run.
func runDBStatus(ctx context.Context, d deps, inv invocation) error {
	slug := d.resolvedStack()
	report := map[string]any{}
	for _, engine := range []string{"postgres", "clickhouse", "redis"} {
		raw, err := captureOutput(func() error { return d.orch.DBURL(ctx, d.params, engine) })
		if err != nil {
			report[engine] = map[string]string{"error": err.Error()}
			continue
		}
		report[engine] = strings.TrimSpace(string(raw))
	}
	seed := d.orch.SeedStatusLine(slug)
	if seed == "" {
		seed = "seed: never ran on this stack (haven db seed runs it)"
	}
	report["seed"] = seed
	if inv.has("--json") || d.isAgent {
		return json.NewEncoder(os.Stdout).Encode(report)
	}
	for _, k := range []string{"postgres", "clickhouse", "redis"} {
		fmt.Printf("%-11s %v\n", k, report[k])
	}
	fmt.Println(seed)
	return nil
}
