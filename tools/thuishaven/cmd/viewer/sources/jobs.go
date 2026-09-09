package sources

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// FileJobs is the jobs tab's real backing: the journal an up appends a record
// to as each one-shot lane finishes, plus that lane's own lines out of the
// stack's combined stream for the drill-in. The two are separate files because
// they are written by different things - the journal by the orchestrator that
// ran the job, the stream by the lane itself - and joining them here is
// cheaper than making either one know about the other.
type FileJobs struct {
	// dir is the stack's log directory, holding the journal.
	dir string
	// combined is the stack's whole-launcher log, where a one-shot lane's own
	// output is labeled with the lane that wrote it.
	combined string
}

// NewFileJobs opens a source over one stack's log directory and combined log.
func NewFileJobs(dir, combined string) FileJobs {
	return FileJobs{dir: dir, combined: combined}
}

// Runs returns this stack's one-shot history, most recent last. A stack with no
// journal yet has no history rather than an error: an up that has not reached
// its first job is the ordinary case on frame one.
func (f FileJobs) Runs() []JobRun {
	records := f.journal()
	if len(records) == 0 {
		return nil
	}
	output := f.laneOutput()
	out := make([]JobRun, 0, len(records))
	for _, rec := range records {
		out = append(out, JobRun{
			Name:     rec.Name,
			At:       rec.At,
			Duration: rec.Duration(),
			Exit:     rec.Exit,
			Output:   output[rec.Name],
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// journal reads every record in the stack's job journal. A malformed line is
// skipped rather than failing the read: the file is appended to by a live
// process, so a partial last line is expected, not corruption.
func (f FileJobs) journal() []domain.OnceJobRun {
	file, err := os.Open(filepath.Join(f.dir, domain.OnceJobJournal))
	if err != nil {
		return nil
	}
	defer func() { _ = file.Close() }()
	var out []domain.OnceJobRun
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var rec domain.OnceJobRun
		if json.Unmarshal(scanner.Bytes(), &rec) == nil && rec.Name != "" {
			out = append(out, rec)
		}
	}
	return out
}

// The combined stream has had two shapes, and a reader of it has to know both.
// The launcher used to write "lane │ text"; it now writes the same rendered
// form every other view uses, "23:35:08.662  codegen           Node.js v24…" -
// a time column, a lane column and the text. A parser that knows only the old
// one finds no output at all for any job, which is what a failed codegen with
// no visible reason looked like.

// laneLabel matches the older "lane │ text" prefix, with or without the escape
// sequences the label is painted in, and with either bar character.
var laneLabel = regexp.MustCompile(`^(?:\x1b\[[0-9;]*m)*\s*([a-z0-9-]+)\s*(?:\x1b\[[0-9;]*m)*\s*[|│]\s?(.*)$`)

// laneColumns matches the rendered form: a clock, then the lane column, then
// the level column (blank for a passthrough line) and the message.
var laneColumns = regexp.MustCompile(`^\d{2}:\d{2}:\d{2}\.\d{3}\s{2}([a-z0-9-]+)\s+(.*)$`)

// laneOf reads which lane wrote one line of the combined stream, in either
// shape, and what it said.
func laneOf(raw string) (lane, text string, ok bool) {
	for _, shape := range []*regexp.Regexp{laneLabel, laneColumns} {
		if match := shape.FindStringSubmatch(stripSGR(raw)); len(match) == 3 {
			return match[1], match[2], true
		}
	}
	return "", "", false
}

// stripSGR removes the escape sequences a rendered line carries, so the columns
// can be counted in characters a person would see.
func stripSGR(line string) string {
	var b strings.Builder
	for i := 0; i < len(line); i++ {
		if line[i] != 0x1b {
			b.WriteByte(line[i])
			continue
		}
		for i < len(line) && !isSGRFinal(line[i]) {
			i++
		}
	}
	return b.String()
}

func isSGRFinal(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' }

// laneOutput slices the combined stream into each one-shot lane's own lines.
func (f FileJobs) laneOutput() map[string][]string {
	data, err := os.ReadFile(f.combined)
	if err != nil {
		return nil
	}
	out := map[string][]string{}
	for _, raw := range strings.Split(string(data), "\n") {
		lane, text, ok := laneOf(raw)
		if !ok || !domain.IsOnceJobLane(lane) {
			continue
		}
		out[lane] = append(out[lane], text)
	}
	return out
}
