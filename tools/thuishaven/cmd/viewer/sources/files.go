package sources

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// FileLogs tails the per-lane capture files the supervisor writes. It is the
// log tab's default backing and the only one that works with the observability
// stack down, which is why it is the default: a viewer whose logs depend on a
// container is a viewer that shows nothing on the morning the container did not
// start.

// tailWindow bounds the FIRST read of any capture file. The tab only ever
// renders the last few hundred lines, while a long-lived worktree's capture
// reaches tens of megabytes, so a fresh source opens at a bounded tail rather
// than at byte zero.
const tailWindow = 256 << 10

// staleGrace covers lanes that wrote just before the viewer finished opening.
const staleGrace = 10 * time.Second

// FileLogs reads every live capture in a stack's log directory.
type FileLogs struct {
	dir string
	// since is the instant the viewer opened. A capture last written before it
	// belongs to a lane that no longer runs - a retired lane name, an earlier
	// selection - and is left to `haven logs` rather than shown as live output.
	since   time.Time
	offsets map[string]int64
}

// NewFileLogs opens a source over a stack's capture directory. Captures last
// written before `since` are ignored.
func NewFileLogs(dir string, since time.Time) *FileLogs {
	return &FileLogs{dir: dir, since: since, offsets: map[string]int64{}}
}

// Lanes lists the capture files currently considered live, by file name.
func (f *FileLogs) Lanes() []string {
	entries, err := os.ReadDir(f.dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		name, ok := strings.CutSuffix(e.Name(), ".log")
		if !ok || !f.live(e.Name()) {
			continue
		}
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// live reports whether a capture has been written since the viewer opened.
func (f *FileLogs) live(fileName string) bool {
	info, err := os.Stat(filepath.Join(f.dir, fileName))
	if err != nil {
		return false
	}
	return !info.ModTime().Before(f.since.Add(-staleGrace))
}

// Fresh returns every line appended across the live captures since the last
// call, merged in time order so a burst on one lane cannot jump ahead of an
// earlier line on another.
func (f *FileLogs) Fresh() []LogLine {
	var out []LogLine
	for _, lane := range f.Lanes() {
		for _, raw := range f.tail(lane) {
			if line, ok := parseCaptured(lane, raw); ok {
				out = append(out, line)
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// parseCaptured splits one captured line into its timestamp and payload. A line
// with no parseable timestamp is a partial write, dropped rather than guessed at.
func parseCaptured(lane, raw string) (LogLine, bool) {
	stamp, rest, ok := strings.Cut(raw, " ")
	if !ok {
		return LogLine{}, false
	}
	at, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil {
		return LogLine{}, false
	}
	line := LogLine{At: at, Lane: lane, Text: rest}
	if rec, parsed := logfmt.Parse(rest); parsed {
		line.Level = string(rec.Level)
	}
	return line, true
}

// tail returns the whole lines appended to one capture since the previous pass,
// starting over when the file rotated (shrank) underneath us.
func (f *FileLogs) tail(lane string) []string {
	path := filepath.Join(f.dir, lane+".log")
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	offset, partial := f.startOffset(lane, info.Size())
	if info.Size() == offset {
		f.offsets[lane] = offset
		return nil
	}
	text, ok := readAt(path, offset, info.Size()-offset)
	if !ok {
		return nil
	}
	f.offsets[lane] = info.Size()
	if partial {
		if nl := strings.IndexByte(text, '\n'); nl >= 0 {
			text = text[nl+1:]
		} else {
			text = ""
		}
	}
	return nonEmptyLines(text)
}

// startOffset resolves where this pass reads from, and whether that offset
// lands mid-line (true only for the bounded first read of a large file).
func (f *FileLogs) startOffset(lane string, size int64) (offset int64, partial bool) {
	offset, seen := f.offsets[lane]
	if !seen {
		if size > tailWindow {
			return size - tailWindow, true
		}
		return 0, false
	}
	if size < offset {
		return 0, false
	}
	return offset, false
}

func readAt(path string, offset, length int64) (string, bool) {
	file, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer func() { _ = file.Close() }()
	buf := make([]byte, length)
	if _, err := file.ReadAt(buf, offset); err != nil {
		return "", false
	}
	return string(buf), true
}

func nonEmptyLines(text string) []string {
	var out []string
	for _, raw := range strings.Split(text, "\n") {
		if raw != "" {
			out = append(out, raw)
		}
	}
	return out
}
