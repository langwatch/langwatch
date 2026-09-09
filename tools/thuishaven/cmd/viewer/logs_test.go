package viewer

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// logsTab builds a logs tab over memory doubles, with rendering reduced to the
// payload so an assertion reads the line rather than its escape sequences.
func logsTab(t *testing.T, lokiUp bool) (*LogsTab, *sources.MemoryLogs, *sources.MemoryLogs) {
	t.Helper()
	files, loki := &sources.MemoryLogs{}, &sources.MemoryLogs{}
	tab := NewLogsTab(Sources{
		Files: files, Loki: loki, LokiUp: func() bool { return lokiUp },
		Render: func(line sources.LogLine) string { return line.Text },
		Now:    time.Now,
	})
	return tab, files, loki
}

// observe feeds the tab the lines a file tail would have handed it.
func observe(tab *LogsTab, lines ...sources.LogLine) {
	for _, line := range lines {
		tab.Observe(line)
	}
}

func line(lane, text string) sources.LogLine {
	return sources.LogLine{At: time.Now(), Lane: lane, Text: text}
}

// @scenario "The logs sub-tabs are the applications, not the lanes"
func TestLogsSubTabsAreApplications(t *testing.T) {
	t.Run("given no output at all", func(t *testing.T) {
		tab, _, _ := logsTab(t, false)
		if got := tab.SubTabs(); len(got) != 1 || got[0] != AllApps {
			t.Fatalf("sub-tabs = %v, want just %q before any lane has written", got, AllApps)
		}
	})

	t.Run("when the lanes have written, only their applications appear", func(t *testing.T) {
		tab, _, _ := logsTab(t, false)
		observe(tab,
			line("ui", "vite ready"),
			line("backend", `{"name":"langwatch:api","level":"info","msg":"listening"}`),
			line("backend", `{"name":"langwatch:worker:clickhouse","level":"info","msg":"projecting"}`),
			line("go", `{"service":"langwatch-service-nlpgo","level":"info","msg":"ready"}`),
		)
		want := []string{"all", "ui", "api", "worker", "nlp"}
		if got := tab.SubTabs(); strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("sub-tabs = %v, want %v - the applications with output, in the fixed order", got, want)
		}
		for _, absent := range []string{"backend", "go", "gateway", "langy"} {
			for _, app := range tab.SubTabs() {
				if app == absent {
					t.Errorf("sub-tab %q appeared with nothing behind it", absent)
				}
			}
		}
	})
}

// @scenario "A backend line lands under api or worker by its name field"
func TestBackendLinesSplitByLoggerName(t *testing.T) {
	tab, _, _ := logsTab(t, false)
	observe(tab,
		line("backend", `{"name":"langwatch:worker:clickhouse","level":"info","msg":"projecting"}`),
		line("backend", `{"name":"langwatch:api:auth","level":"info","msg":"signing in"}`),
	)
	if got := strings.Join(tab.Lines("worker"), "|"); !strings.Contains(got, "projecting") {
		t.Errorf("worker lines = %q, want the clickhouse projection line", got)
	}
	if got := strings.Join(tab.Lines("api"), "|"); strings.Contains(got, "projecting") {
		t.Errorf("api lines = %q, want the worker's line filed under worker", got)
	}
	if got := strings.Join(tab.Lines("api"), "|"); !strings.Contains(got, "signing in") {
		t.Errorf("api lines = %q, want the langwatch:api line", got)
	}
}

// @scenario "A go line lands under gateway or nlp by its service field"
func TestGoLinesSplitByServiceName(t *testing.T) {
	cases := []struct {
		service string
		want    string
	}{
		{service: "langwatch-service-nlpgo", want: "nlp"},
		{service: "langwatch-service-aigateway", want: "gateway"},
	}
	for _, tc := range cases {
		t.Run(tc.service, func(t *testing.T) {
			tab, _, _ := logsTab(t, false)
			observe(tab, line("go", `{"service":"`+tc.service+`","level":"info","msg":"ready"}`))
			if got := tab.Lines(tc.want); len(got) != 1 {
				t.Errorf("%s lines = %v, want the line under %s", tc.want, got, tc.want)
			}
		})
	}
}

// @scenario "An unstructured line stays with its lane's default application"
func TestUnstructuredLineFollowsTheLastStructuredOne(t *testing.T) {
	tab, _, _ := logsTab(t, false)
	observe(tab,
		line("backend", `{"name":"langwatch:worker:clickhouse","level":"error","msg":"insert failed"}`),
		line("backend", "    at Object.insert (worker/clickhouse.ts:44:11)"),
	)
	frames := strings.Join(tab.Lines("worker"), "|")
	if !strings.Contains(frames, "at Object.insert") {
		t.Errorf("worker lines = %q, want the stack frame to follow its own error", frames)
	}
	if strings.Contains(strings.Join(tab.Lines("api"), "|"), "at Object.insert") {
		t.Error("the stack frame landed under api, tearing it off the error above it")
	}

	t.Run("when the lane has written nothing structured yet", func(t *testing.T) {
		fresh, _, _ := logsTab(t, false)
		observe(fresh, line("backend", "node:internal/modules/esm/resolve:274"))
		if got := fresh.Lines("api"); len(got) != 1 {
			t.Errorf("api lines = %v, want the lane's default application to take it", got)
		}
	})
}

// @scenario "Level keys narrow the stream"
func TestLevelKeysNarrowTheStream(t *testing.T) {
	tab, _, _ := logsTab(t, false)
	observe(tab,
		line("ui", `{"level":"debug","msg":"a debug line"}`),
		line("ui", `{"level":"warn","msg":"a warn line"}`),
		line("ui", `{"level":"error","msg":"an error line"}`),
	)
	frame := Frame{Width: 120, Height: 20}

	cases := []struct {
		key    string
		want   []string
		absent []string
		footer string
	}{
		{key: "w", want: []string{"a warn line", "an error line"}, absent: []string{"a debug line"}, footer: "warn and above"},
		{key: "e", want: []string{"an error line"}, absent: []string{"a warn line", "a debug line"}, footer: "errors only"},
		{key: "a", want: []string{"a debug line", "a warn line", "an error line"}, footer: "everything"},
	}
	for _, tc := range cases {
		t.Run("when the developer presses "+tc.key, func(t *testing.T) {
			if !tab.Key(tc.key) {
				t.Fatalf("%q was not claimed by the logs tab", tc.key)
			}
			body := strings.Join(tab.Body(frame), "\n")
			for _, want := range tc.want {
				if !strings.Contains(body, want) {
					t.Errorf("body after %q is missing %q", tc.key, want)
				}
			}
			for _, absent := range tc.absent {
				if strings.Contains(body, absent) {
					t.Errorf("body after %q still shows %q", tc.key, absent)
				}
			}
			if !strings.Contains(tab.Footer(), tc.footer) {
				t.Errorf("footer after %q = %q, want it to say %q", tc.key, tab.Footer(), tc.footer)
			}
		})
	}
}

// @scenario "The muted console is named and Loki is one key away"
func TestLokiIsOneKeyAway(t *testing.T) {
	tab, files, loki := logsTab(t, true)
	loki.Append(line("langwatch-app", `{"level":"debug","msg":"only Loki has this"}`))
	files.Append(line("ui", `{"level":"warn","msg":"the console kept this one"}`))

	t.Run("given the observability stack is up", func(t *testing.T) {
		if !strings.Contains(tab.Footer(), "in Loki") {
			t.Errorf("footer = %q, want it to say the info and debug lines are in Loki", tab.Footer())
		}
	})

	t.Run("when the developer presses L", func(t *testing.T) {
		if !tab.Key("L") {
			t.Fatal("L was not claimed by the logs tab")
		}
		tab.Poll()
		if got := strings.Join(tab.Lines(AllApps), "|"); !strings.Contains(got, "only Loki has this") {
			t.Errorf("lines = %q, want the sub-tab reading Loki", got)
		}
		if !strings.Contains(tab.Footer(), "source Loki") {
			t.Errorf("footer = %q, want it to name Loki as the source", tab.Footer())
		}
	})

	t.Run("when L is pressed again, the source switches back", func(t *testing.T) {
		tab.Key("L")
		tab.Poll()
		if loki.Calls != 1 {
			t.Errorf("Loki was polled %d times, want the switch back to stop asking it", loki.Calls)
		}
		observe(tab, line("ui", `{"level":"warn","msg":"back on the files"}`))
		if got := strings.Join(tab.Lines("ui"), "|"); !strings.Contains(got, "back on the files") {
			t.Errorf("lines = %q, want the capture files again", got)
		}
	})
}
