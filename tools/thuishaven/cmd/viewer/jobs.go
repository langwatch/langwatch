package viewer

import (
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// JobsTab is the history of the one-shot lanes: the dependency install, the
// codegen, the migrations, the seed, the image build. They are not services, so
// nothing supervises them and nothing else remembers they happened - which is
// why an up that "took a while" is otherwise minutes nobody can account for.

// JobsTab is the jobs screen.
type JobsTab struct {
	noHeader
	src    Sources
	runs   []sources.JobRun
	cursor int
	// openJob is the run drilled into, empty on the list.
	openJob string
}

// NewJobsTab builds the jobs screen over the one-shot journal.
func NewJobsTab(src Sources) *JobsTab { return &JobsTab{src: src} }

// Name is the tab's label and command name.
func (t *JobsTab) Name() string { return "jobs" }

// Attention marks the jobs tab when a one-shot lane finished while the reader
// was elsewhere. A failed one is red, because it is the only thing on this
// screen that ever needs answering.
func (t *JobsTab) Attention(since time.Time) Attention {
	mark := AttentionNone
	for _, run := range t.runs {
		if !run.At.After(since) {
			continue
		}
		if !run.OK() {
			return AttentionFailure
		}
		mark = AttentionNotice
	}
	return mark
}

// Poll re-reads the journal.
func (t *JobsTab) Poll() {
	if t.src.Jobs == nil {
		return
	}
	t.runs = t.src.Jobs.Runs()
}

// Body renders the run list, or the drilled-into run's captured output.
func (t *JobsTab) Body(f Frame) []Row {
	if t.openJob != "" {
		return t.outputBody(f)
	}
	if len(t.runs) == 0 {
		return emptyBody("one-shot jobs in this up")
	}
	now := t.src.Now()
	out := make([]string, 0, len(t.runs))
	keys := make([]string, 0, len(t.runs))
	for i, run := range t.runs {
		out = append(out, t.row(i, run, now))
		keys = append(keys, run.Name)
		if reason := failureReason(run); reason != "" {
			out = append(out, reason)
			keys = append(keys, run.Name+":reason")
		}
	}
	return lastNRows(keyedRows(out, keys), f.Rows())
}

// row renders one run: its name, when it ran, how long it took and its exit.
func (t *JobsTab) row(i int, run sources.JobRun, now time.Time) string {
	outcome := green("ok")
	if !run.OK() {
		outcome = red("exit " + itoa(run.Exit))
	}
	line := " " + pad(run.Name, 14) + dim(pad(ago(run.At, now), 12)) +
		pad(shortDuration(run.Duration), 10) + outcome
	if i == t.cursor {
		return sgrReverse + "›" + line + sgrReset
	}
	return " " + line
}

// failureReason is the one line under a failed run: the last thing it said
// before it gave up. A row that says "exit 1" and nothing else sends the reader
// into the drill-in to find out what every failure already told them on its
// last line, and most of the time that line is the whole answer.
func failureReason(run sources.JobRun) string {
	if run.OK() {
		return ""
	}
	last := reasonLine(run.Output)
	if last == "" {
		return "   " + dim("no output captured - enter for the full log")
	}
	return "   " + dim(last)
}

// failureWords are how a tool says it failed. A build that fails still prints
// progress afterwards - a summary, a cleanup line, a shell's own epilogue - so
// the last line a job wrote is often not the line that says why it stopped.
var failureWords = []string{"error", "Error", "ERROR", "failed", "Failed", "FAIL", "Cannot", "cannot find", "ENOENT"}

// reasonLine picks the one line to show under a failed run: the last one that
// reads as the failure, and otherwise the last one that said anything at all.
func reasonLine(output []string) string {
	fallback := ""
	for i := len(output) - 1; i >= 0; i-- {
		trimmed := strings.TrimSpace(output[i])
		if trimmed == "" {
			continue
		}
		if fallback == "" {
			fallback = trimmed
		}
		for _, word := range failureWords {
			if strings.Contains(trimmed, word) {
				return trimmed
			}
		}
	}
	return fallback
}

// outputBody is the drilled-into run's captured output.
func (t *JobsTab) outputBody(f Frame) []Row {
	for _, run := range t.runs {
		if run.Name != t.openJob {
			continue
		}
		if len(run.Output) == 0 {
			return emptyBody("captured output for " + run.Name)
		}
		out := make([]string, 0, len(run.Output)+1)
		out = append(out, " "+bold(run.Name))
		for _, line := range run.Output {
			out = append(out, " "+line)
		}
		return lastNRows(textRows(out), f.Rows())
	}
	return emptyBody("captured output")
}

// Footer names what the keys do on whichever half of the tab is showing.
func (t *JobsTab) Footer() string {
	if t.openJob != "" {
		return dim("esc back to the list")
	}
	return dim("↑↓ move · enter shows that job's whole captured output")
}

// Key moves the cursor and opens or closes the drill-in.
func (t *JobsTab) Key(k string) bool {
	switch k {
	case "up", "k":
		t.cursor = maxInt(t.cursor-1, 0)
	case "down", "j":
		t.cursor = minInt(t.cursor+1, maxInt(len(t.runs)-1, 0))
	case "enter":
		if t.cursor < len(t.runs) {
			t.openJob = t.runs[t.cursor].Name
		}
	case "esc":
		if t.openJob == "" {
			return false
		}
		t.openJob = ""
	default:
		return false
	}
	return true
}

// Rows is the run list as plain data.
func (t *JobsTab) Rows() any { return t.runs }

// Open is the run drilled into, empty on the list.
func (t *JobsTab) Open() string { return t.openJob }
