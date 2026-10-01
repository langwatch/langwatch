package visualdiff

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
)

const statusFixture = `Intro the run never touches.

<!-- parity-status:start -->
## Status

### visualdiff flows (2)

| flow | proves | last result | state | next |
|---|---|---|---|---|
| trace-view | spans show | renders like main | 🟢 | first run with expects |
| automation-create | automation listed | ❌ click times out | ❌ | fix the form |

### features

| area | state |
|---|---|
| automation-create | ❌ |
<!-- parity-status:end -->

| automation-create | outside the markers | x | ❌ | y |
`

func statusRows() []Row {
	return []Row{
		flowRow(100, ClassNoise, `text "VD Automation"`, "", ""),
		{Edition: EditionEnterprise, Kind: "flow", Key: "pairwise", Index: 1, Label: "open", Class: ClassBroken, Why: "drawer | never opened",
			Base: &Capture{}, Candidate: &Capture{Error: "timeout"}},
	}
}

// @scenario "A run rewrites only its own flows' rows of the parity status in the PR body"
func TestARunRewritesOnlyItsFlowsRowsOfTheParityStatus(t *testing.T) {
	statuses := FlowStatuses(JudgeFlows(statusRows()))

	spliced, err := SpliceFlowStatus(statusFixture, statuses)
	if err != nil {
		t.Fatal(err)
	}

	want := strings.Replace(strings.Replace(statusFixture, "### visualdiff flows (2)", "### visualdiff flows (3)", 1),
		"| automation-create | automation listed | ❌ click times out | ❌ | fix the form |\n",
		"| automation-create | automation listed | works (1 expects held) | ✅ | fix the form |\n"+
			"| pairwise |  | broken: step 1 open · side candidate · broken: drawer / never opened | ❌ |  |\n", 1)
	if spliced != want {
		t.Fatalf("spliced:\n%s\nwant:\n%s", spliced, want)
	}

	crlf, err := SpliceFlowStatus(strings.ReplaceAll(statusFixture, "\n", "\r\n"), statuses)
	if err != nil {
		t.Fatal(err)
	}
	mustContain(t, crlf, "| works (1 expects held) | ✅ | fix the form |\r\n")
	if _, err := SpliceFlowStatus("no markers", statuses); err == nil {
		t.Fatal("a body without the markers is refused")
	}
}

// statusFake answers the body read with gh noise around the JSON line.
type statusFake struct {
	patched string
}

func (fake *statusFake) run(_ context.Context, spec commandSpec, log io.Writer) error {
	if len(spec.args) > 2 && spec.args[2] == "-X" {
		content, err := os.ReadFile(strings.TrimPrefix(spec.args[5], "body=@"))
		fake.patched = string(content)
		return err
	}
	encoded, _ := json.Marshal(statusFixture)
	_, err := io.WriteString(log, "A new release of gh is available\n"+string(encoded)+"\n")
	return err
}

func TestTheStatusIsPatchedWithoutGhsOwnOutput(t *testing.T) {
	fake := &statusFake{}
	request := PublishRequest{Rows: statusRows(), RunDir: t.TempDir(), Stderr: io.Discard}

	if err := (ghClient{run: fake.run, root: "/repo"}).publishStatus(context.Background(), request, "7536"); err != nil {
		t.Fatal(err)
	}

	if strings.Contains(fake.patched, "new release") || !strings.HasPrefix(fake.patched, "Intro the run never touches.") {
		t.Fatalf("patched body:\n%s", fake.patched)
	}
}
