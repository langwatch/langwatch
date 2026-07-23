package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The `haven logs` command: every service's captured output, from any
// terminal, whether the stack runs attached, detached, or already stopped.
// Filtering is a plain argument (`haven logs nlp`), following is -f, time
// windows are --since, severity is --level, another stack is --stack. The
// supervisor writes the per-service files this reads (adapters/procsupervisor
// logsink.go); the launcher's terminal view and these files carry the same
// lines.

// logsTailLines is how much history a plain `haven logs` prints.
const logsTailLines = 200

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
	"app": "34", "api": "35", "gateway": "33", "nlp": "36", "langy": "92", "workers": "32",
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

	lines, offsets := readLogTails(dir, services)
	lines = filterLogLines(lines, since, level)
	if since.IsZero() && len(lines) > logsTailLines {
		lines = lines[len(lines)-logsTailLines:]
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

// readLogTails reads every selected service's capture (rotated generation
// first, then live), returning the parsed lines merged in time order and each
// live file's end offset for a follow to continue from.
func readLogTails(dir string, services []string) ([]logLine, map[string]int64) {
	var lines []logLine
	offsets := map[string]int64{}
	for _, svc := range services {
		live := filepath.Join(dir, svc+".log")
		for _, path := range []string{live + ".1", live} {
			b, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			if path == live {
				offsets[svc] = int64(len(b))
			}
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
	return lines, offsets
}

// logLevelRank orders the severities a --level filter understands.
var logLevelRank = map[string]int{"trace": 1, "debug": 2, "info": 3, "warn": 4, "warning": 4, "error": 5, "fatal": 6}

func minLevelRank(level string) int { return logLevelRank[strings.ToLower(level)] }

// lineLevelRank sniffs a line's severity from its first level-looking token.
// 0 means the line names no level (a continuation, a raw print) — such lines
// pass an unfiltered view and are hidden by --level.
func lineLevelRank(text string) int {
	for _, tok := range strings.Fields(text) {
		tok = strings.Trim(tok, "[]():")
		if r, ok := logLevelRank[strings.ToLower(tok)]; ok {
			return r
		}
	}
	return 0
}

func filterLogLines(lines []logLine, since time.Time, level string) []logLine {
	min := minLevelRank(level)
	var out []logLine
	for _, l := range lines {
		if !since.IsZero() && l.ts.Before(since) {
			continue
		}
		if min > 0 && lineLevelRank(l.text) < min {
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
			buf := make([]byte, info.Size()-offset)
			if _, err := f.ReadAt(buf, offset); err == nil {
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
