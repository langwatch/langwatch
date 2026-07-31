package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeLog(t *testing.T, dir, service string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, service+".log"), []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

// @scenario "Everything, labelled and interleaved"
func TestReadLogTailsInterleavesByTime(t *testing.T) {
	dir := t.TempDir()
	base := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	writeLog(t, dir, "nlp", stamp(base.Add(2*time.Second))+" nlp second")
	writeLog(t, dir, "app", stamp(base.Add(1*time.Second))+" app first", stamp(base.Add(3*time.Second))+" app third")

	lines, offsets, _ := readLogTails(dir, []string{"app", "nlp"})
	if len(lines) != 3 {
		t.Fatalf("lines = %d, want 3", len(lines))
	}
	order := []string{lines[0].text, lines[1].text, lines[2].text}
	if order[0] != "app first" || order[1] != "nlp second" || order[2] != "app third" {
		t.Errorf("merge order = %v, want time order across services", order)
	}
	if offsets["app"] == 0 || offsets["nlp"] == 0 {
		t.Error("offsets must record each live file's end for follow to continue from")
	}
}

// @scenario "Filtering to one service is a plain argument"
func TestSelectLogServices(t *testing.T) {
	dir := t.TempDir()
	writeLog(t, dir, "app", stamp(time.Now())+" x")
	writeLog(t, dir, "langyagent", stamp(time.Now())+" y")

	t.Run("when no service is named, every captured one is read", func(t *testing.T) {
		got, err := selectLogServices(dir, nil)
		if err != nil {
			t.Fatalf("selectLogServices: %v", err)
		}
		if len(got) != 2 {
			t.Errorf("got %v, want both services", got)
		}
	})

	t.Run("when the CLI name langy is used, the langyagent capture is read", func(t *testing.T) {
		got, err := selectLogServices(dir, []string{"langy"})
		if err != nil {
			t.Fatalf("selectLogServices: %v", err)
		}
		if len(got) != 1 || got[0] != "langyagent" {
			t.Errorf("got %v, want the langyagent capture", got)
		}
	})

	t.Run("when a service has no capture, the error lists what exists in CLI spelling", func(t *testing.T) {
		_, err := selectLogServices(dir, []string{"nlp"})
		if err == nil || !strings.Contains(err.Error(), "langy") || strings.Contains(err.Error(), "langyagent") {
			t.Fatalf("want available services in CLI spelling, got %v", err)
		}
	})
}

// @scenario "A time window is one flag"
// @scenario "Severity is a filter, not a grep"
func TestFilterLogLines(t *testing.T) {
	base := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	lines := []logLine{
		{ts: base, service: "app", text: "INFO booted"},
		{ts: base.Add(time.Minute), service: "app", text: "WARN slow query"},
		{ts: base.Add(2 * time.Minute), service: "nlp", text: "ERROR exploded"},
		{ts: base.Add(3 * time.Minute), service: "nlp", text: "no level here"},
	}

	t.Run("since drops older lines", func(t *testing.T) {
		got := filterLogLines(lines, base.Add(90*time.Second), "")
		if len(got) != 2 {
			t.Errorf("got %d lines, want the 2 after the window start", len(got))
		}
	})

	t.Run("level warn keeps warn and worse only", func(t *testing.T) {
		got := filterLogLines(lines, time.Time{}, "warn")
		if len(got) != 2 || got[0].text != "WARN slow query" || got[1].text != "ERROR exploded" {
			t.Errorf("got %v, want the warn and error lines", got)
		}
	})

	t.Run("no filter passes level-less lines through", func(t *testing.T) {
		if got := filterLogLines(lines, time.Time{}, ""); len(got) != 4 {
			t.Errorf("got %d, want all 4", len(got))
		}
	})

	// Captured output is raw service stdout, so the level word arrives wrapped in
	// colour escapes. Hand-written plain fixtures pass while the filter drops
	// every real line, so these are shaped like what the sink actually stores.
	t.Run("given colourised output, as every real service emits", func(t *testing.T) {
		colourised := []logLine{
			{ts: base, service: "nlp", text: "\x1b[0m\x1b[32mINFO\x1b[0m\x1b[32m listening on :5561\x1b[0m"},
			{ts: base.Add(time.Minute), service: "nlp", text: "\x1b[0m\x1b[33mWARN\x1b[0m\x1b[33m slow query\x1b[0m"},
			{ts: base.Add(2 * time.Minute), service: "app", text: "\x1b[31mERROR\x1b[0m exploded"},
		}

		t.Run("when filtering by level, the escapes do not hide the severity", func(t *testing.T) {
			got := filterLogLines(colourised, time.Time{}, "warn")
			if len(got) != 2 {
				t.Errorf("got %d lines, want the warn and error lines — ANSI must be stripped before sniffing", len(got))
			}
		})
	})

	// "trace" and "debug" are ordinary nouns in this codebase, so a level word
	// found deep in prose is almost always a false positive.
	t.Run("given a level word appearing in the middle of a message", func(t *testing.T) {
		prose := []logLine{
			{ts: base, service: "app", text: "ERROR failed to fetch trace abc: connection refused"},
		}

		t.Run("when filtering by warn, the line is still surfaced", func(t *testing.T) {
			if got := filterLogLines(prose, time.Time{}, "warn"); len(got) != 1 {
				t.Error("an ERROR line must not be reclassified by the word 'trace' later in the message")
			}
		})
	})
}

// The sink stamps every line in UTC and time.Parse hands it back in UTC, so
// formatting it as-is reported live output as hours old anywhere but Britain in
// winter — which reads as a stale capture rather than as a timezone.
//
// @scenario "Timestamps are on the reader's own clock"
func TestFormatLogLineUsesTheLocalClock(t *testing.T) {
	// A fixed zone rather than the test machine's: the assertion has to fail on a
	// UTC CI box too, or it pins nothing.
	amsterdam := time.FixedZone("CEST", 2*60*60)
	instant := time.Date(2026, 7, 30, 23, 37, 33, 0, time.UTC)

	t.Run("given a line captured in UTC and a reader two hours ahead", func(t *testing.T) {
		t.Run("when the line is rendered", func(t *testing.T) {
			got := formatLogLineIn(logLine{ts: instant, service: "app", text: "hello"}, true, amsterdam)
			if !strings.HasPrefix(got, "01:37:33") {
				t.Errorf("rendered %q, want the reader's 01:37:33 — a UTC column reads as hours-old output", got)
			}
		})
	})

	t.Run("given the same line and a reader in UTC", func(t *testing.T) {
		t.Run("when the line is rendered", func(t *testing.T) {
			got := formatLogLineIn(logLine{ts: instant, service: "app", text: "hello"}, true, time.UTC)
			if !strings.HasPrefix(got, "23:37:33") {
				t.Errorf("rendered %q, want 23:37:33", got)
			}
		})
	})
}

// @scenario "How much history is a flag, and the clipping is stated"
func TestLogLineLimit(t *testing.T) {
	for _, tc := range []struct {
		name    string
		raw     string
		want    int
		wantErr bool
	}{
		{name: "unset falls back to the default window", raw: "", want: logsTailLines},
		{name: "a count is used as given", raw: "50", want: 50},
		{name: "zero means every line the bounded read produced", raw: "0", want: 0},
		{name: "a negative count is refused", raw: "-3", wantErr: true},
		{name: "a non-number is refused", raw: "lots", wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := logLineLimit(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("logLineLimit(%q) = %d, want an error", tc.raw, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("logLineLimit(%q): %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("logLineLimit(%q) = %d, want %d", tc.raw, got, tc.want)
			}
		})
	}
}

// `haven restart -t` follows from where the captures stood before the bounce,
// so it shows the restart rather than replaying the history that preceded it.
// @scenario "Restarting can stay attached to what comes next"
func TestLogEndOffsetsRecordEveryCapturesEnd(t *testing.T) {
	dir := t.TempDir()
	writeLog(t, dir, "app", stamp(time.Now())+" before the bounce")
	writeLog(t, dir, "nlp", stamp(time.Now())+" also before")

	offsets := logEndOffsets(dir)
	if len(offsets) != 2 {
		t.Fatalf("offsets = %v, want one per capture", offsets)
	}
	for svc, off := range offsets {
		info, err := os.Stat(filepath.Join(dir, svc+".log"))
		if err != nil {
			t.Fatal(err)
		}
		if off != info.Size() {
			t.Errorf("%s offset = %d, want the file's end %d", svc, off, info.Size())
		}
	}
}

// @scenario "Logs outlive the stack"
func TestReadLogTailsIncludesRotatedGeneration(t *testing.T) {
	dir := t.TempDir()
	base := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.log.1"), []byte(stamp(base)+" old generation\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeLog(t, dir, "app", stamp(base.Add(time.Second))+" live generation")

	lines, _, _ := readLogTails(dir, []string{"app"})
	if len(lines) != 2 || lines[0].text != "old generation" {
		t.Errorf("lines = %v, want the rotated generation first", lines)
	}
}

// A stack left up writes a capture far larger than any view of it. Reading the
// whole file to print the last 200 lines is the difference between megabytes
// and hundreds of them, and `haven logs` is the command an agent reaches for
// most — so the read is bounded, and the bound never costs the lines the
// command was going to display.
//
// The cap is injected rather than taken from logReadCapBytes: a fixture sized
// off the production constant would cost whatever that constant is next raised
// to, which is how this test first hung instead of failing.
//
// @scenario "A huge capture is read from its tail, not whole"
func TestReadLogTailsBoundsWhatItReadsFromAHugeCapture(t *testing.T) {
	const capBytes = 16 << 10

	dir := t.TempDir()
	base := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)

	// ~100 bytes a line, written well past the cap so the tail is a small
	// fraction of the file — the shape of a stack left up overnight.
	filler := strings.Repeat("x", 64)
	var b strings.Builder
	written := 0
	for i := 0; b.Len() < capBytes*8; i++ {
		b.WriteString(stamp(base.Add(time.Duration(i) * time.Millisecond)))
		b.WriteString(" ")
		b.WriteString(filler)
		b.WriteString("\n")
		written++
	}
	path := filepath.Join(dir, "app.log")
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("given a capture larger than the read cap", func(t *testing.T) {
		t.Run("when the tail is read", func(t *testing.T) {
			data, size, capped, err := readLogTailCapped(path, capBytes)
			if err != nil {
				t.Fatalf("readLogTailCapped: %v", err)
			}
			if !capped {
				t.Error("a capture past the cap must report that history was elided")
			}
			if int64(len(data)) > capBytes {
				t.Errorf("read %d bytes, want no more than the %d-byte cap", len(data), capBytes)
			}
			if size != info.Size() {
				t.Errorf("size = %d, want the file's full size %d so a follow continues from the end", size, info.Size())
			}
			// A capped read starts mid-line; that fragment must never be parsed
			// as a line, so what survives begins at a real record boundary.
			if _, ok := parseLogLine("app", strings.SplitN(string(data), "\n", 2)[0]); !ok {
				t.Error("the first surviving line is a fragment — the partial leading line was not dropped")
			}
		})

		t.Run("when the command reads its tails", func(t *testing.T) {
			lines, offsets, elided := readLogTailsCapped(dir, []string{"app"}, capBytes)
			if !elided {
				t.Error("readLogTails must report the elision so the developer is told")
			}
			if len(lines) >= written {
				t.Errorf("parsed %d lines of %d written; the read was not bounded", len(lines), written)
			}
			if len(lines) == 0 {
				t.Fatal("the bounded read produced nothing")
			}
			if offsets["app"] != info.Size() {
				t.Errorf("offset = %d, want the full size %d — a follow must not replay the whole tail", offsets["app"], info.Size())
			}
			// The tail is the newest history, which is the part anyone asked for.
			if last := lines[len(lines)-1].ts; !last.Equal(base.Add(time.Duration(written-1) * time.Millisecond)) {
				t.Errorf("last line is %v, want the newest line written", last)
			}
		})
	})

	// The production cap has to be generous enough that no ordinary capture ever
	// meets it — a developer must not be told history was elided on a file the
	// command would have read whole anyway.
	t.Run("given an ordinary capture", func(t *testing.T) {
		t.Run("when the command reads its tails", func(t *testing.T) {
			ordinary := t.TempDir()
			writeLog(t, ordinary, "app", stamp(base)+" one line")

			if _, _, elided := readLogTails(ordinary, []string{"app"}); elided {
				t.Error("a one-line capture was reported as elided; the production cap is too small")
			}
		})
	})
}
