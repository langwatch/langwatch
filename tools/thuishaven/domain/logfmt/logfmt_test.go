package logfmt

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// fixtureTime is the capture instant the shared fixture's non-JSON lines are
// rendered at. The Node renderer's test uses the same one.
var fixtureTime = time.Date(2026, 9, 7, 11, 10, 51, 0, time.UTC)

// repoRoot walks up from this test file to the checkout root. The fixture is
// shared with dev/scripts/log-render.mjs on purpose — one written format, two
// implementations — so it cannot live inside this package.
func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate this test file")
	}
	// tools/thuishaven/domain/logfmt/logfmt_test.go -> the checkout root.
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "..")
}

func readFixture(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(repoRoot(t), "dev", "scripts", "fixtures", name)
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("the shared log-format fixture moved or was deleted (%s): %v", path, err)
	}
	return string(body)
}

// TestRenderMatchesSharedFixture is the contract between this renderer and
// dev/scripts/log-render.mjs: same input lines, same bytes out. Change the
// format in one and this fails in the other.
func TestRenderMatchesSharedFixture(t *testing.T) {
	t.Setenv("TZ", "UTC")
	time.Local = time.UTC

	input := readFixture(t, "dev-log-lines.jsonl")
	want := readFixture(t, "dev-log-lines.expected.txt")

	var got strings.Builder
	for _, line := range strings.Split(strings.TrimRight(input, "\n"), "\n") {
		got.WriteString(Render(line, Options{Lane: "api", Time: fixtureTime}))
		got.WriteString("\n")
	}
	if got.String() != want {
		t.Errorf("rendered output drifted from the shared fixture\n--- got ---\n%s\n--- want ---\n%s", got.String(), want)
	}
}

// @scenario "One rendering, whatever the service logs with"
func TestRender(t *testing.T) {
	time.Local = time.UTC
	base := Options{Lane: "api", Time: fixtureTime}

	cases := []struct {
		name string
		line string
		opts Options
		want string
	}{
		{
			name: "a structured line becomes fixed columns and key=value fields",
			line: `{"time":"2026-09-07T11:10:46.108Z","level":"info","msg":"listening","service":"langwatch-api","port":6560}`,
			opts: base,
			want: "11:10:46.108  api        info   listening  port=6560",
		},
		{
			name: "a line that is not JSON keeps the lane column and a blank level",
			line: "exited — restarting in 1s",
			opts: base,
			want: "11:10:51.000  api               exited — restarting in 1s",
		},
		{
			name: "a stack trace is indented under its line",
			line: `{"time":"2026-09-07T11:10:46.108Z","level":"error","msg":"boom","stack":"Error: boom\n    at run (job.ts:1:1)"}`,
			opts: base,
			want: "11:10:46.108  api        error  boom\n        at run (job.ts:1:1)",
		},
		{
			name: "a lane name that exactly fills the column and the longest level still align",
			line: `{"time":"2026-09-07T11:10:46.108Z","level":"error","msg":"x"}`,
			opts: Options{Lane: "mail-room", Time: fixtureTime},
			want: "11:10:46.108  mail-room  error  x",
		},
		{
			name: "constant process identity is dropped, the line's own fields are not",
			line: `{"time":"2026-09-07T11:10:46.108Z","level":"warn","msg":"x","pid":1,"hostname":"box","service":"s","version":"v","env":"local","keep":"yes"}`,
			opts: base,
			want: "11:10:46.108  api        warn   x  keep=yes",
		},
		{
			name: "another tool's JSON is passed through rather than rendered empty",
			line: `{"schemaVersion":3,"outputs":[]}`,
			opts: base,
			want: `11:10:51.000  api               {"schemaVersion":3,"outputs":[]}`,
		},
		{
			name: "a zap epoch timestamp reads as a clock",
			line: `{"ts":1788779448.25,"level":"info","msg":"x"}`,
			opts: base,
			want: "11:10:48.250  api        info   x",
		},
		{
			name: "a record with an empty message, no fields and no stack is not worth a line",
			line: `{"time":"2026-09-07T11:10:46.108Z","level":"info","msg":""}`,
			opts: base,
			want: "",
		},
		{
			name: "an empty message still prints when the record carries a field",
			line: `{"time":"2026-09-07T11:10:46.108Z","level":"info","msg":"","keep":"yes"}`,
			opts: base,
			want: "11:10:46.108  api        info     keep=yes",
		},
		{
			name: "a passthrough line that is only whitespace is dropped",
			line: "   ",
			opts: base,
			want: "",
		},
		{
			name: "a passthrough line that is only color escapes is dropped",
			line: "\x1b[2m\x1b[22m",
			opts: base,
			want: "",
		},
		{
			name: "a passthrough line that is only box-drawing decoration is dropped",
			line: "────────────────",
			opts: base,
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Render(tc.line, tc.opts); got != tc.want {
				t.Errorf("Render() =\n%q\nwant\n%q", got, tc.want)
			}
		})
	}
}

// @scenario "A tool banner renders as one line or not at all"
func TestRenderViteBanner(t *testing.T) {
	time.Local = time.UTC
	opts := Options{Lane: "ui", Time: time.Date(2026, 9, 7, 4, 39, 39, 0, time.UTC)}

	t.Run("the ready line and everything around it collapse to one record", func(t *testing.T) {
		// The exact defect from a real haven log: Vite's own logger bakes its
		// multi-line startup banner - the ready line, the blank spacing, the
		// routed addresses and the shortcut hint - into one record's message
		// as embedded newlines.
		line := `{"time":"2026-09-07T04:39:39.099Z","level":"info","msg":"\n  VITE v8.1.2  ready in 1814 ms\n\n  ➜  Local:   https://app.langwatch.localhost/\n  ➜  Network: use --host to expose\n  ➜  press h + enter to show help\n"}`
		want := "04:39:39.099  ui         info   vite 8.1.2 ready in 1814 ms"
		if got := Render(line, opts); got != want {
			t.Errorf("Render() =\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("a banner with nothing but the addresses and the help hint drops entirely", func(t *testing.T) {
		line := `{"time":"2026-09-07T04:39:39.099Z","level":"info","msg":"\n  ➜  Local:   https://app.langwatch.localhost/\n  ➜  Network: use --host to expose\n  ➜  press h + enter to show help\n"}`
		if got := Render(line, opts); got != "" {
			t.Errorf("Render() = %q, want empty", got)
		}
	})

	t.Run("an already-clean single-line ready message is left exactly as written", func(t *testing.T) {
		line := `{"time":"2026-09-07T04:39:39.099Z","level":"info","msg":"VITE v8.1.2  ready in 1814 ms"}`
		want := "04:39:39.099  ui         info   VITE v8.1.2  ready in 1814 ms"
		if got := Render(line, opts); got != want {
			t.Errorf("Render() =\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("the raw ready line, not wrapped in JSON, still collapses", func(t *testing.T) {
		want := "04:39:39.000  ui         info   vite 8.1.2 ready in 1814 ms"
		if got := Render("VITE v8.1.2  ready in 1814 ms", opts); got != want {
			t.Errorf("Render() =\n%q\nwant\n%q", got, want)
		}
	})

	t.Run("a raw address or help line, not wrapped in JSON, drops", func(t *testing.T) {
		for _, line := range []string{
			"➜  Local:   https://app.langwatch.localhost/",
			"➜  Network: use --host to expose",
			"➜  press h + enter to show help",
		} {
			if got := Render(line, opts); got != "" {
				t.Errorf("Render(%q) = %q, want empty", line, got)
			}
		}
	})
}

func TestRenderColor(t *testing.T) {
	time.Local = time.UTC
	line := `{"time":"2026-09-07T11:10:46.108Z","level":"error","msg":"boom"}`

	t.Run("when color is on, the level and the lane are painted", func(t *testing.T) {
		got := Render(line, Options{Lane: "api", LaneColor: "35", Color: true})
		for _, want := range []string{"\x1b[35mapi", "\x1b[31merror"} {
			if !strings.Contains(got, want) {
				t.Errorf("Render() = %q, want it to contain %q", got, want)
			}
		}
	})

	t.Run("when color is off, nothing is painted", func(t *testing.T) {
		got := Render(line, Options{Lane: "api", LaneColor: "35"})
		if strings.Contains(got, "\x1b[") {
			t.Errorf("Render() = %q, want no escape sequences", got)
		}
	})

	t.Run("when color is on, a level with no color of its own is left alone", func(t *testing.T) {
		got := Render(`{"time":"2026-09-07T11:10:46.108Z","level":"info","msg":"x"}`, Options{Color: true})
		if strings.Contains(got, "\x1b[m") {
			t.Errorf("Render() = %q, want info to carry no SGR of its own", got)
		}
	})
}

// @scenario "A machine consumer gets one object per line"
func TestRenderJSON(t *testing.T) {
	t.Run("when the line is already JSON, the lane is stamped on it", func(t *testing.T) {
		got := RenderJSON(`{"level":"info","msg":"x"}`, Options{Lane: "api", Time: fixtureTime})
		for _, want := range []string{`"lane":"api"`, `"msg":"x"`, `"time":"2026-09-07T11:10:51.000Z"`} {
			if !strings.Contains(got, want) {
				t.Errorf("RenderJSON() = %s, want it to contain %s", got, want)
			}
		}
	})

	t.Run("when the line is not JSON, it becomes a record so every line parses", func(t *testing.T) {
		got := RenderJSON("exited — restarting in 1s", Options{Lane: "workers", Time: fixtureTime})
		for _, want := range []string{`"lane":"workers"`, `"msg":"exited — restarting in 1s"`} {
			if !strings.Contains(got, want) {
				t.Errorf("RenderJSON() = %s, want it to contain %s", got, want)
			}
		}
	})
}

func TestNormalizeLevel(t *testing.T) {
	cases := map[string]Level{
		"INFO": LevelInfo, "warning": LevelWarn, "Err": LevelError,
		"dpanic": LevelError, "panic": LevelFatal, "chatty": LevelNone,
	}
	for in, want := range cases {
		if got := NormalizeLevel(in); got != want {
			t.Errorf("NormalizeLevel(%q) = %q, want %q", in, got, want)
		}
	}
}

// @scenario "One rendering, whatever the service logs with"
func TestRenderInsetsAMultiLineMessage(t *testing.T) {
	line := `{"level":"fatal","time":"2026-09-18T10:00:00.000Z","msg":"boot failed: [\n  {\n    \"code\": \"invalid_type\"\n  }\n]"}`

	out := Render(line, Options{Lane: "worker"})

	rows := strings.Split(out, "\n")
	if len(rows) < 2 {
		t.Fatalf("render = %q, want the message's own newlines kept", out)
	}
	if strings.Contains(rows[0], "\n") || !strings.Contains(rows[0], "boot failed:") {
		t.Errorf("first row = %q, want the message to start on the column line", rows[0])
	}
	for _, row := range rows[1:] {
		if !strings.HasPrefix(row, "    ") {
			t.Errorf("continuation %q is at the margin; it must be inset so the columns still read", row)
		}
	}
}

// @scenario "One rendering, whatever the service logs with"
func TestRenderShortensAnErrorTheMessageAlreadyReadsOut(t *testing.T) {
	t.Run("when the serialized error repeats the message, only what it adds is kept", func(t *testing.T) {
		line := `{"level":"fatal","time":"2026-09-18T10:00:00.000Z","msg":"fatal boot failure: table claimed twice","error":{"type":"OwnershipError","message":"table claimed twice"}}`

		out := Render(line, Options{Lane: "worker"})

		if !strings.Contains(out, "error=OwnershipError") {
			t.Errorf("render = %q, want the error shortened to its type", out)
		}
		if strings.Count(out, "table claimed twice") != 1 {
			t.Errorf("render = %q, want the repeated message read out once", out)
		}
	})

	t.Run("when the serialized error says something else, it is kept whole", func(t *testing.T) {
		line := `{"level":"fatal","time":"2026-09-18T10:00:00.000Z","msg":"boot failed","error":{"type":"OwnershipError","message":"table claimed twice"}}`

		out := Render(line, Options{Lane: "worker"})

		if !strings.Contains(out, "table claimed twice") {
			t.Errorf("render = %q, want an error the message does not carry kept whole", out)
		}
	})
}

// @scenario "One rendering, whatever the service logs with"
func TestRenderKeepsAnEmbeddedPayloadsOwnIndentation(t *testing.T) {
	// The Vite banner collapse trims every line it touches. Applied to any
	// multi-line message it flattens a payload whose nesting is its meaning.
	line := `{"level":"fatal","time":"2026-09-18T10:00:00.000Z","msg":"rejected: [\n  {\n    \"code\": \"invalid_type\"\n  }\n]"}`

	out := Render(line, Options{Lane: "worker"})

	if !strings.Contains(out, `        "code": "invalid_type"`) {
		t.Errorf("render = %q, want the payload's own nesting kept under the inset", out)
	}
}

// @scenario "One rendering, whatever the service logs with"
func TestRenderReadsARepeatedStackHeaderOnce(t *testing.T) {
	t.Run("when the header repeats a message that embeds a report, only the frames are kept", func(t *testing.T) {
		line := `{"level":"fatal","time":"2026-09-18T10:00:00.000Z","msg":"boot failed: rejected: [\n  {\n    \"code\": \"invalid_type\"\n  }\n]","stack":"ConfigError: rejected: [\n  {\n    \"code\": \"invalid_type\"\n  }\n]\n    at parse (kernel.ts:1:1)"}`

		out := Render(line, Options{Lane: "worker"})

		if strings.Count(out, "invalid_type") != 1 {
			t.Errorf("render = %q, want the report read out once, not once per copy", out)
		}
		if !strings.Contains(out, "at parse (kernel.ts:1:1)") {
			t.Errorf("render = %q, want the frames the stack alone adds", out)
		}
	})

	t.Run("when the header is one line, it is still only read once", func(t *testing.T) {
		line := `{"level":"fatal","time":"2026-09-18T10:00:00.000Z","msg":"boot failed: the mcp member cannot be supplied","stack":"MissingMemberError: the mcp member cannot be supplied\n    at build (members.ts:1:1)"}`

		out := Render(line, Options{Lane: "worker"})

		if strings.Count(out, "the mcp member cannot be supplied") != 1 {
			t.Errorf("render = %q, want the message read out once however short the header is", out)
		}
		if !strings.Contains(out, "error=MissingMemberError") {
			t.Errorf("render = %q, want the type the trimmed header named kept as a field", out)
		}
	})

	// "Error" is what an error is. Surfacing it as a field would spend a column
	// on the one type name that tells a reader nothing.
	t.Run("when the trimmed header named no useful type, no field is invented", func(t *testing.T) {
		line := `{"level":"error","time":"2026-09-18T10:00:00.000Z","msg":"boom","stack":"Error: boom\n    at run (job.ts:1:1)"}`

		out := Render(line, Options{Lane: "worker"})

		if strings.Contains(out, "error=") {
			t.Errorf("render = %q, want no error field for a bare Error", out)
		}
		if !strings.Contains(out, "at run (job.ts:1:1)") {
			t.Errorf("render = %q, want the frames kept", out)
		}
	})

	t.Run("when the header says something the message does not, it is kept", func(t *testing.T) {
		line := `{"level":"fatal","time":"2026-09-18T10:00:00.000Z","msg":"boot failed","stack":"ConfigError: a different cause\n  with its own detail\n    at parse (kernel.ts:1:1)"}`

		out := Render(line, Options{Lane: "worker"})

		if !strings.Contains(out, "a different cause") {
			t.Errorf("render = %q, want a header the message does not carry kept", out)
		}
	})
}
