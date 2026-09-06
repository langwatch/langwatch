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
			want: "11:10:46.108  api        error  boom\n    Error: boom\n        at run (job.ts:1:1)",
		},
		{
			name: "the longest lane and the longest level still align",
			line: `{"time":"2026-09-07T11:10:46.108Z","level":"error","msg":"x"}`,
			opts: Options{Lane: "storybook", Time: fixtureTime},
			want: "11:10:46.108  storybook  error  x",
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
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Render(tc.line, tc.opts); got != tc.want {
				t.Errorf("Render() =\n%q\nwant\n%q", got, tc.want)
			}
		})
	}
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
