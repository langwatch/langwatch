package featureparity

import (
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"
)

// Run is the CLI: `--json` for the machine-readable report. It returns 1 when
// the run fails, as the Node tool's process.exit(1) does, and 0 otherwise.
func Run(args []string, stdout, stderr io.Writer) int {
	cwd, err := os.Getwd()
	if err == nil {
		cwd, err = FindRepoRoot(cwd)
	}
	if err != nil {
		fmt.Fprintln(stderr, "Error:", err)
		return 1
	}
	return RunAt(cwd, DefaultLists(), args, stdout, stderr)
}

// RunAt is Run against the tree at repo, judged by lists.
func RunAt(repo string, lists Lists, args []string, stdout, stderr io.Writer) int {
	asJSON := slices.Contains(args, "--json")
	a, err := Analyze(repo, lists)
	if err != nil {
		fmt.Fprintln(stderr, "Error:", err)
		return 1
	}
	if asJSON {
		writeJSON(stdout, a)
	} else {
		PrintReport(stdout, a)
	}
	if reasons := FatalReasons(a); len(reasons) > 0 {
		if !asJSON {
			for _, e := range a.ListErrors {
				fmt.Fprintln(stderr, "Exemption list: "+e)
			}
			fmt.Fprintln(stderr, "FAIL: "+strings.Join(reasons, ", ")+". See spec-binding convention in dev/docs/TESTING_PHILOSOPHY.md.")
		}
		return 1
	}
	if !asJSON {
		printOK(stdout, a)
	}
	return 0
}

// jsonString escapes s as JSON.stringify does: unlike encoding/json it leaves
// <, >, & and U+2028/U+2029 alone.
func jsonString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// jsonWriter renders values in JSON.stringify(value, null, 2) layout.
type jsonWriter struct {
	b     strings.Builder
	depth int
}

func (j *jsonWriter) nl() { j.b.WriteString("\n" + strings.Repeat("  ", j.depth)) }

// object writes key/value pairs; each value is a func that writes itself.
func (j *jsonWriter) object(kv ...any) {
	j.b.WriteByte('{')
	j.depth++
	for i := 0; i < len(kv); i += 2 {
		if i > 0 {
			j.b.WriteByte(',')
		}
		j.nl()
		j.b.WriteString(jsonString(kv[i].(string)) + ": ")
		j.value(kv[i+1])
	}
	j.depth--
	j.nl()
	j.b.WriteByte('}')
}

func array[T any](j *jsonWriter, items []T, each func(T)) {
	if len(items) == 0 {
		j.b.WriteString("[]")
		return
	}
	j.b.WriteByte('[')
	j.depth++
	for i, it := range items {
		if i > 0 {
			j.b.WriteByte(',')
		}
		j.nl()
		each(it)
	}
	j.depth--
	j.nl()
	j.b.WriteByte(']')
}

func (j *jsonWriter) value(v any) {
	switch v := v.(type) {
	case string:
		j.b.WriteString(jsonString(v))
	case int:
		j.b.WriteString(strconv.Itoa(v))
	case []string:
		array(j, v, func(s string) { j.b.WriteString(jsonString(s)) })
	case func():
		v()
	}
}

func (j *jsonWriter) scenario(s Scenario, bindings []BindingRef, withBindings bool) {
	kv := []any{"title", s.Title, "tags", s.Tags, "line", s.Line}
	if withBindings {
		kv = append(kv, "bindings", func() { array(j, bindings, j.ref) })
	}
	j.object(kv...)
}

func (j *jsonWriter) ref(r BindingRef) { j.object("file", r.File, "line", r.Line) }

func (j *jsonWriter) inert(r InertReport) {
	j.object("feature", r.Feature, "totalScenarios", r.TotalScenarios, "unimplemented", r.Unimplemented)
}

func (j *jsonWriter) partial(r PartialReport) {
	j.object("feature", r.Feature, "totalScenarios", r.TotalScenarios, "enforced", r.Enforced, "untagged", r.Untagged)
}

func writeJSON(w io.Writer, a Analysis) {
	j := &jsonWriter{}
	staleLegacy := make([]string, len(a.StaleLegacy))
	for i, r := range a.StaleLegacy {
		staleLegacy[i] = r.Feature
	}
	j.object(
		"enforced", func() {
			array(j, a.Enforced, func(r Report) {
				j.object(
					"feature", r.Feature,
					"scenarios", func() { array(j, r.Scenarios, func(s AnnotatedScenario) { j.scenario(s.Scenario, s.Bindings, true) }) },
					"unbound", func() { array(j, r.Unbound, func(s Scenario) { j.scenario(s, nil, false) }) },
					"totalScenarios", r.TotalScenarios,
					"unimplementedScenarios", r.UnimplementedScenarios,
					"untaggedScenarios", r.UntaggedScenarios,
				)
			})
		},
		"legacy", func() {
			array(j, a.Legacy, func(r LegacyReport) {
				j.object("feature", r.Feature, "bound", r.Bound, "unbound", r.Unbound, "total", r.Total, "unboundTitles", r.UnboundTitles)
			})
		},
		"unknownAnnotations", func() {
			array(j, a.Unknown, func(b Binding) { j.object("title", b.Title, "ref", func() { j.ref(b.Ref) }) })
		},
		"listErrors", a.ListErrors,
		"staleLegacy", staleLegacy,
		"inert", func() { array(j, a.ExemptInert, j.inert) },
		"newInert", func() { array(j, a.NewInert, j.inert) },
		"staleInert", a.StaleInert,
		"partial", func() { array(j, a.ExemptPartial, j.partial) },
		"newPartial", func() { array(j, a.NewPartial, j.partial) },
		"stalePartial", a.StalePartial,
	)
	fmt.Fprintln(w, j.b.String())
}
