package cmd

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The `haven logs` command: every service's captured output, from any
// terminal, whether the stack runs attached, detached, or already stopped.
// Filtering is a plain argument (`haven logs nlp`), following is -t, time
// windows are --since, severity is --level, another stack is --stack. The
// supervisor writes the per-service files this reads (adapters/procsupervisor
// logsink.go); the launcher's terminal view and these files carry the same
// lines.

// logsTailLines is how much history a plain `haven logs` prints.
const logsTailLines = 200

// logReadCapBytes bounds how much of one capture file a single read pulls into
// memory. A stack left up overnight writes a capture far larger than anything
// this command prints — the default view is the last 200 lines — and reading
// every byte of every selected service to find them is the difference between
// a few megabytes and a few hundred. 8 MiB is tens of thousands of lines, so
// the cap is invisible to every ordinary `--since` window and only bites where
// the alternative was reading a file nothing was ever going to display.
const logReadCapBytes = 8 << 20

// cliToFileService maps a CLI service name to its capture-file basename.
func cliToFileService(name string) string {
	if name == "langy" {
		return "langyagent"
	}
	return name
}

func fileToCLIService(name string) string {
	if name == "langyagent" {
		return "langy"
	}
	return name
}

// logServiceColors mirrors the supervisor's lane palette so a service reads
// the same in `haven logs` as it did live.
var logServiceColors = map[string]string{
	"ui": "34", "api": "35", "gateway": "33", "nlp": "36", "langy": "92", "workers": "32",
}

func runLogsCmd(ctx context.Context, d deps, inv invocation) error {
	// The observability stack is a container, not a supervised child — its logs
	// come from docker, but through the same one command.
	if len(inv.args) == 1 && inv.args[0] == "obs" {
		return d.orch.ObservabilityLogs(ctx, inv.has("--tail"))
	}

	slug := inv.value("--stack")
	if slug == "" {
		resolved, err := d.orch.ResolveSlug(d.params)
		if err != nil {
			return err
		}
		slug = resolved
	} else if !domain.ValidSlug(slug) {
		// This value becomes a path segment below. Every other slug entry point
		// gates on ValidSlug; without it `--stack ../../..` walks out of the haven
		// home and prints whatever *.log files it finds there.
		return fmt.Errorf("--stack %q is not a valid stack slug", slug)
	}
	dir := filepath.Join(havenHome(), "logs", slug)

	var since time.Time
	if v := inv.value("--since"); v != "" {
		window, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("--since wants a duration like 10m or 1h, got %q", v)
		}
		since = time.Now().Add(-window)
	}
	level := inv.value("--level")
	if level != "" && minLevelRank(level) == 0 {
		return fmt.Errorf("--level wants debug, info, warn, or error, got %q", level)
	}

	services, err := selectLogServices(dir, inv.args)
	if err != nil {
		return err
	}

	lines, offsets, elided := readLogTails(dir, services)
	lines = filterLogLines(lines, since, level)
	if since.IsZero() && len(lines) > logsTailLines {
		lines = lines[len(lines)-logsTailLines:]
	}
	if elided {
		// stderr, so a `haven logs | grep` or an agent parsing stdout sees only
		// log lines — but the developer is still told their window was clipped
		// rather than silently shown a shorter history than they asked for.
		fmt.Fprintf(os.Stderr, "(reading the last %d MiB of each capture — older history elided)\n", logReadCapBytes>>20)
	}
	for _, l := range lines {
		printLogLine(l, d.isAgent)
	}
	if !inv.has("--tail") {
		if len(lines) == 0 {
			fmt.Println("(no matching log lines yet)")
		}
		return nil
	}
	return followLogs(ctx, dir, inv.args, offsets, since, level, d.isAgent)
}

// selectLogServices resolves which capture files to read: the named services,
// or every one present. Naming a service that has no capture yet is an error
// listing what exists — not silence.
func selectLogServices(dir string, args []string) ([]string, error) {
	available := capturedServices(dir)
	if len(args) == 0 {
		if len(available) == 0 {
			return nil, fmt.Errorf("no captured logs for this stack yet — logs appear once `haven up` has run it")
		}
		return available, nil
	}
	availableSet := map[string]bool{}
	for _, s := range available {
		availableSet[s] = true
	}
	var out []string
	for _, a := range args {
		name := cliToFileService(a)
		if !availableSet[name] {
			cliNames := make([]string, len(available))
			for i, s := range available {
				cliNames[i] = fileToCLIService(s)
			}
			return nil, fmt.Errorf("no captured logs for %q — this stack has: %s (plus obs)", a, strings.Join(cliNames, ", "))
		}
		out = append(out, name)
	}
	return out, nil
}

// capturedServices lists the services with capture files, in a stable order.
func capturedServices(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if name, ok := strings.CutSuffix(e.Name(), ".log"); ok {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

type logLine struct {
	ts      time.Time
	service string // CLI spelling
	text    string
}

// parseLogLine splits a captured line into its timestamp and payload. Lines
// without a parseable timestamp (partial writes) are dropped rather than
// guessed at.
func parseLogLine(service, raw string) (logLine, bool) {
	ts, rest, ok := strings.Cut(raw, " ")
	if !ok {
		return logLine{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return logLine{}, false
	}
	return logLine{ts: t, service: fileToCLIService(service), text: rest}, true
}

// readLogTail reads at most the last logReadCapBytes of path.
func readLogTail(path string) (data []byte, size int64, capped bool, err error) {
	return readLogTailCapped(path, logReadCapBytes)
}

// readLogTailCapped reads at most the last capBytes of path. It returns the
// bytes, the file's full size (what a follow must continue from, not what was
// read), and whether the cap truncated the history. A capped read lands
// mid-line, so the leading partial line is dropped rather than parsed.
//
// The cap is a parameter so a test can exercise the truncation against a small
// fixture: sizing one from logReadCapBytes would make the test cost whatever
// that constant is next raised to.
func readLogTailCapped(path string, capBytes int64) (data []byte, size int64, capped bool, err error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, false, err
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil {
		return nil, 0, false, err
	}
	size = info.Size()
	start := int64(0)
	if size > capBytes {
		start, capped = size-capBytes, true
	}
	buf := make([]byte, size-start)
	// A short read means the file was rotated or truncated under us; whatever
	// arrived is still valid lines, so keep it rather than discarding the read.
	n, err := f.ReadAt(buf, start)
	if n == 0 && err != nil {
		return nil, size, capped, err
	}
	buf = buf[:n]
	if capped {
		buf = dropPartialFirstLine(buf)
	}
	return buf, size, capped, nil
}

// dropPartialFirstLine discards everything up to and including the first
// newline — what a read that started at an arbitrary byte offset picked up
// mid-line.
func dropPartialFirstLine(buf []byte) []byte {
	if i := bytes.IndexByte(buf, '\n'); i >= 0 {
		return buf[i+1:]
	}
	return nil
}

// readLogTails reads every selected service's capture (rotated generation
// first, then live), returning the parsed lines merged in time order, each
// live file's end offset for a follow to continue from, and whether any file
// was large enough that logReadCapBytes elided older history.
func readLogTails(dir string, services []string) ([]logLine, map[string]int64, bool) {
	return readLogTailsCapped(dir, services, logReadCapBytes)
}

func readLogTailsCapped(dir string, services []string, capBytes int64) ([]logLine, map[string]int64, bool) {
	var lines []logLine
	offsets := map[string]int64{}
	elided := false
	for _, svc := range services {
		live := filepath.Join(dir, svc+".log")
		for _, path := range []string{live + ".1", live} {
			b, size, capped, err := readLogTailCapped(path, capBytes)
			if err != nil {
				continue
			}
			if path == live {
				offsets[svc] = size
			}
			elided = elided || capped
			for _, raw := range strings.Split(string(b), "\n") {
				if raw == "" {
					continue
				}
				if l, ok := parseLogLine(svc, raw); ok {
					lines = append(lines, l)
				}
			}
		}
	}
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].ts.Before(lines[j].ts) })
	return lines, offsets, elided
}

// logLevelRank orders the severities a --level filter understands.
var logLevelRank = map[string]int{"trace": 1, "debug": 2, "info": 3, "warn": 4, "warning": 4, "error": 5, "fatal": 6}

func minLevelRank(level string) int { return logLevelRank[strings.ToLower(level)] }

// ansiSequence matches the escape sequences services colour their output with.
// Captured logs are raw service stdout, so a level word arrives wrapped —
// pino-pretty and the Go services both emit things like
// "\x1b[0m\x1b[33mWARN\x1b[0m". Tokenising that text without stripping the
// escapes finds no level word at all, which silently made --level drop every
// line it was meant to select.
var ansiSequence = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)

func stripANSI(s string) string { return ansiSequence.ReplaceAllString(s, "") }

// levelSniffTokens bounds how far into a line a level word is looked for. A
// level prefix appears at the very start; scanning the whole line means ordinary
// prose ("failed to fetch trace abc") is read as a severity and the line is
// hidden by exactly the filter meant to surface it.
const levelSniffTokens = 4

// lineLevelRank sniffs a line's severity from its leading level-looking token.
// 0 means the line names no level (a continuation, a raw print) — such lines
// pass an unfiltered view and are hidden by --level.
func lineLevelRank(text string) int {
	fields := strings.Fields(stripANSI(text))
	for i, tok := range fields {
		if i >= levelSniffTokens {
			break
		}
		tok = strings.Trim(tok, "[]():")
		if r, ok := logLevelRank[strings.ToLower(tok)]; ok {
			return r
		}
	}
	return 0
}

func filterLogLines(lines []logLine, since time.Time, level string) []logLine {
	minRank := minLevelRank(level)
	var out []logLine
	for _, l := range lines {
		if !since.IsZero() && l.ts.Before(since) {
			continue
		}
		if minRank > 0 && lineLevelRank(l.text) < minRank {
			continue
		}
		out = append(out, l)
	}
	return out
}

func printLogLine(l logLine, plain bool) { fmt.Println(formatLogLine(l, plain)) }

// formatLogLine renders one captured line: plain for pipes/agents, coloured
// label + warn/error highlighting for humans. Shared by `haven logs` and the
// attached up viewer so a service reads the same everywhere.
func formatLogLine(l logLine, plain bool) string {
	if plain {
		return fmt.Sprintf("%s %-8s | %s", l.ts.Format("15:04:05.000"), l.service, l.text)
	}
	color := logServiceColors[l.service]
	if color == "" {
		color = "37"
	}
	return fmt.Sprintf("\x1b[2m%s\x1b[0m \x1b[%sm%-8s\x1b[0m │ %s", l.ts.Format("15:04:05.000"), color, l.service, highlightLevel(l.text))
}

// highlightLevel paints a line red at error-or-worse, yellow at warn.
func highlightLevel(text string) string {
	switch rank := lineLevelRank(text); {
	case rank >= 5:
		return "\x1b[31m" + text + "\x1b[0m"
	case rank == 4:
		return "\x1b[33m" + text + "\x1b[0m"
	}
	return text
}

// followLogs streams appended lines until interrupted, re-scanning the
// directory each pass so a service added by a later `up +svc` joins the view.
func followLogs(ctx context.Context, dir string, args []string, offsets map[string]int64, since time.Time, level string, plain bool) error {
	requested := map[string]bool{}
	for _, a := range args {
		requested[cliToFileService(a)] = true
	}
	t := time.NewTicker(300 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
		var fresh []logLine
		for _, svc := range capturedServices(dir) {
			if len(requested) > 0 && !requested[svc] {
				continue
			}
			path := filepath.Join(dir, svc+".log")
			info, err := os.Stat(path)
			if err != nil {
				continue
			}
			offset := offsets[svc]
			if info.Size() < offset {
				offset = 0 // rotated underneath us — start over on the fresh file
			}
			if info.Size() == offset {
				continue
			}
			f, err := os.Open(path)
			if err != nil {
				continue
			}
			// Same bound as the initial read: a service that dumps a burst
			// between two ticks (or a rotation that reset the offset to 0 on a
			// file that is already large) must not size an allocation off it.
			start := offset
			if info.Size()-start > logReadCapBytes {
				start = info.Size() - logReadCapBytes
			}
			buf := make([]byte, info.Size()-start)
			if _, err := f.ReadAt(buf, start); err == nil {
				if start != offset {
					buf = dropPartialFirstLine(buf)
				}
				for _, raw := range strings.Split(string(buf), "\n") {
					if raw == "" {
						continue
					}
					if l, ok := parseLogLine(svc, raw); ok {
						fresh = append(fresh, l)
					}
				}
			}
			_ = f.Close()
			offsets[svc] = info.Size()
		}
		sort.SliceStable(fresh, func(i, j int) bool { return fresh[i].ts.Before(fresh[j].ts) })
		for _, l := range filterLogLines(fresh, since, level) {
			printLogLine(l, plain)
		}
	}
}
