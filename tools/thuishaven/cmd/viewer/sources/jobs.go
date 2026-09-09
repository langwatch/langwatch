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

// laneLabel matches the combined stream's "lane │ text" prefix, with or without
// the escape sequences the label is painted in, and with either bar character:
// the launcher writes the box-drawing one and older captures the plain pipe.
var laneLabel = regexp.MustCompile(`^(?:\x1b\[[0-9;]*m)*\s*([a-z0-9-]+)\s*(?:\x1b\[[0-9;]*m)*\s*[|│]\s?(.*)$`)

// laneOutput slices the combined stream into each one-shot lane's own lines.
func (f FileJobs) laneOutput() map[string][]string {
	data, err := os.ReadFile(f.combined)
	if err != nil {
		return nil
	}
	out := map[string][]string{}
	for _, raw := range strings.Split(string(data), "\n") {
		match := laneLabel.FindStringSubmatch(raw)
		if len(match) < 3 || !domain.IsOnceJobLane(match[1]) {
			continue
		}
		out[match[1]] = append(out[match[1]], match[2])
	}
	return out
}
