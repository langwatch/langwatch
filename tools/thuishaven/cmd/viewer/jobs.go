package viewer

import (
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// JobsTab is the history of the one-shot lanes: the dependency install, the
// codegen, the migrations, the seed, the image build. They are not services, so
// nothing supervises them and nothing else remembers they happened - which is
// why an up that "took a while" is otherwise minutes nobody can account for.

// JobsTab is the jobs screen.
type JobsTab struct {
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

// Poll re-reads the journal.
func (t *JobsTab) Poll() {
	if t.src.Jobs == nil {
		return
	}
	t.runs = t.src.Jobs.Runs()
}

// Body renders the run list, or the drilled-into run's captured output.
func (t *JobsTab) Body(f Frame) []string {
	if t.openJob != "" {
		return t.outputBody(f)
	}
	if len(t.runs) == 0 {
		return emptyBody("one-shot jobs in this up")
	}
	now := t.src.Now()
	out := make([]string, 0, len(t.runs))
	for i, run := range t.runs {
		out = append(out, t.row(i, run, now))
	}
	return lastN(out, f.Rows())
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

// outputBody is the drilled-into run's captured output.
func (t *JobsTab) outputBody(f Frame) []string {
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
		return lastN(out, f.Rows())
	}
	return emptyBody("captured output")
}

// Footer names what the keys do on whichever half of the tab is showing.
func (t *JobsTab) Footer() string {
	if t.openJob != "" {
		return dim("esc back to the list")
	}
	return dim("↑↓ move · enter shows that job's captured output")
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
