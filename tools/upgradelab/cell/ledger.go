package cell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// FlowLedgerIssue is the tested-flow ledger the cell claims and reports to (-ledger).
const FlowLedgerIssue = "repos/langwatch/langwatch/issues/8553"

// FlowResult is what one ledger row records for a run.
type FlowResult struct {
	Status, TestedBy, Date, Evidence, Notes string
}

// SetFlowRow replaces row id's Status, Tested by, Date, Evidence and Notes cells (those its table has),
// keeping every other cell and every other line as it is.
func SetFlowRow(body, id string, result FlowResult) (string, error) {
	lines := strings.Split(body, "\n")
	row := regexp.MustCompile(`^\| ` + regexp.QuoteMeta(id) + ` \|`)
	header := -1
	for index, line := range lines {
		if strings.HasPrefix(line, "| ID |") || strings.HasPrefix(line, "| Id |") {
			header = index
		}
		if !row.MatchString(line) {
			continue
		}
		if header < 0 {
			return "", fmt.Errorf("row %s has no table header above it", id)
		}
		names, cells := tableCells(lines[header]), tableCells(line)
		values := map[string]string{"Status": result.Status, "Tested by": result.TestedBy, "Date": result.Date, "Evidence": result.Evidence, "Notes": result.Notes}
		for column, name := range names {
			if value, ok := values[name]; ok && column < len(cells) {
				cells[column] = strings.ReplaceAll(value, "|", "/")
			}
		}
		lines[index] = "| " + strings.Join(cells, " | ") + " |"
		return strings.Join(lines, "\n"), nil
	}
	return "", fmt.Errorf("no row %s in the ledger", id)
}

// FlowRow is row id's whole line, or "" when the ledger has none.
func FlowRow(body, id string) string {
	return regexp.MustCompile(`(?m)^\| ` + regexp.QuoteMeta(id) + ` \|.*$`).FindString(body)
}

func tableCells(line string) []string {
	cells := strings.Split(strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(line), "|"), "|"), "|")
	for index := range cells {
		cells[index] = strings.TrimSpace(cells[index])
	}
	return cells
}

// PrependLog puts entry first under "## Log", after its introduction.
func PrependLog(body, entry string) (string, error) {
	section := strings.Index(body, "\n## Log\n")
	if section < 0 {
		return "", errors.New("the ledger has no ## Log section")
	}
	first := strings.Index(body[section:], "\n- ")
	if first < 0 {
		return body + "\n" + entry, nil
	}
	at := section + first + 1
	return body[:at] + entry + "\n" + body[at:], nil
}

// publishFlow fetches the body fresh, applies edit, and patches it; when the body changed while the edit
// was made, it starts again once.
func publishFlow(ctx context.Context, runDir string, edit func(string) (string, error)) error {
	for attempt := 0; ; attempt++ {
		body, err := ghBody(ctx)
		if err != nil {
			return err
		}
		edited, err := edit(body)
		if err != nil {
			return err
		}
		if again, err := ghBody(ctx); err != nil || again != body {
			if attempt == 0 {
				continue
			}
			return errors.New("the ledger changed twice while being edited")
		}
		file := filepath.Join(runDir, "ledger-body.md")
		if err := os.WriteFile(file, []byte(edited), 0o600); err != nil {
			return err
		}
		out, err := exec.CommandContext(ctx, "gh", "api", FlowLedgerIssue, "-X", "PATCH", "-F", "body=@"+file).CombinedOutput() // #nosec G204 -- fixed argv.
		if err != nil {
			return fmt.Errorf("gh api PATCH: %w: %s", err, tail(out))
		}
		return nil
	}
}

func ghBody(ctx context.Context) (string, error) {
	out, err := exec.CommandContext(ctx, "gh", "api", FlowLedgerIssue, "-q", ".body").Output() // #nosec G204 -- fixed argv.
	return strings.TrimSuffix(string(out), "\n"), err
}

// claimLedger marks each -ledger row in progress; a failure only warns.
func (cell *run) claimLedger(ctx context.Context) {
	if len(cell.options.Ledger) == 0 {
		return
	}
	claim := FlowResult{Status: "⏳", TestedBy: cell.testedBy(), Date: time.Now().Format(time.DateOnly), Evidence: filepath.Base(cell.options.RunDir) + " in progress"}
	err := publishFlow(ctx, cell.options.RunDir, func(body string) (string, error) {
		cell.ledgerBefore = map[string]string{}
		for _, id := range cell.options.Ledger {
			cell.ledgerBefore[id] = FlowRow(body, id)
			var err error
			if body, err = SetFlowRow(body, id, claim); err != nil {
				return "", err
			}
		}
		return body, nil
	})
	cell.ledgerWarning("claim", err)
}

// reportLedger writes each -ledger row's verdict and one log line per row, newest first.
func (cell *run) reportLedger(ctx context.Context) {
	if len(cell.options.Ledger) == 0 {
		return
	}
	date := time.Now().Format(time.DateOnly)
	err := publishFlow(ctx, cell.options.RunDir, func(body string) (string, error) {
		for _, id := range cell.options.Ledger {
			if before := cell.ledgerBefore[id]; before != "" && len(cell.report.Verdicts) == 0 {
				// A cell stopped before its checks judged nothing: the row goes back to its last result.
				body = strings.Replace(body, FlowRow(body, id), before, 1)
				log := "- " + date + " · " + id + " " + filepath.Base(cell.options.RunDir) + " void (" + scrub(cell.report.Error) + "); row unchanged · " + cell.testedBy()
				var err error
				if body, err = PrependLog(body, log); err != nil {
					return "", err
				}
				continue
			}
			result, summary := cell.flowResult(id, date)
			var err error
			if body, err = SetFlowRow(body, id, result); err != nil {
				return "", err
			}
			if body, err = PrependLog(body, "- "+date+" · "+id+" "+summary+" · "+result.TestedBy); err != nil {
				return "", err
			}
		}
		return body, nil
	})
	cell.ledgerWarning("report", err)
}

func (cell *run) ledgerWarning(what string, err error) {
	if err != nil {
		cell.report.Notes = append(cell.report.Notes, "ledger "+what+" not written: "+err.Error())
		fmt.Fprintf(os.Stderr, "warning: ledger %s not written: %v\n", what, err)
	}
}

func (cell *run) testedBy() string {
	by := "upgradelab " + cell.options.Name() + " " + filepath.Base(cell.options.RunDir)
	if cell.options.TestedBy != "" {
		by = cell.options.TestedBy + " · " + by
	}
	return by
}

// flowResult judges a row by the cell's verdicts; a drill row (UD-n) by its own drill's verdict only.
func (cell *run) flowResult(id, date string) (FlowResult, string) {
	verdicts := cell.report.Verdicts
	if drill, ok := drillRows[id]; ok {
		verdicts = filterVerdicts(verdicts, drill)
	}
	passed, failed := 0, []string{}
	reasons := []string{}
	for _, each := range verdicts {
		if each.Result == "pass" {
			passed++
			continue
		}
		failed = append(failed, each.ID)
		reasons = append(reasons, each.ID+" "+shortReason(each))
	}
	status := "✅"
	if len(failed) > 0 || len(verdicts) == 0 || cell.report.Error != "" {
		status = "❌"
	}
	notes := fmt.Sprintf("%d of %d invariants pass.", passed, len(verdicts))
	if len(reasons) > 0 {
		notes += " Fails: " + strings.Join(reasons, "; ")
	}
	if cell.report.Error != "" {
		notes += " Stopped: " + scrub(cell.report.Error)
	}
	evidence := fmt.Sprintf("cell `%s`, %s → %s, run %s", cell.options.Name(), cell.options.Release, cell.report.HeadCommit, filepath.Base(cell.options.RunDir))
	summary := fmt.Sprintf("%s %s %d/%d", cell.options.Deployment, status, passed, len(verdicts))
	if len(failed) > 0 {
		summary += " (" + strings.Join(failed, " ") + ")"
	}
	return FlowResult{Status: status, TestedBy: cell.testedBy(), Date: date, Evidence: evidence, Notes: notes}, summary
}

func filterVerdicts(verdicts []Verdict, id string) []Verdict {
	var kept []Verdict
	for _, each := range verdicts {
		if each.ID == id {
			kept = append(kept, each)
		}
	}
	return kept
}

// hostish matches what a public ledger must never carry: URLs, addresses, local paths.
var hostish = regexp.MustCompile(`\S*(://|/Users/|/home/|127\.0\.0\.1|localhost|@)\S*`)

func scrub(text string) string {
	return strings.Join(strings.Fields(hostish.ReplaceAllString(text, "…")), " ")
}

// shortReason is the start of a verdict's detail, scrubbed of hosts and paths.
func shortReason(each Verdict) string {
	reason := []rune(scrub(each.Detail))
	if len(reason) > 70 {
		reason = append([]rune(strings.TrimSpace(string(reason[:70]))), '…')
	}
	return "(" + string(reason) + ")"
}

// HeadMarker is written into the head checkout by sync-head.sh: the commit it was synced from and its local changes.
const HeadMarker = ".upgradelab-head"

// HeadCommit names what head ran: the sync marker, else the checkout's commit and its count of local changes.
func HeadCommit(dir string) string {
	if marker, err := os.ReadFile(filepath.Join(dir, HeadMarker)); err == nil { // #nosec G304 -- the harness's own marker.
		return strings.TrimSpace(string(marker))
	}
	commit, err := exec.CommandContext(context.Background(), "git", "-C", dir, "rev-parse", "--short=10", "HEAD").Output() // #nosec G204 -- fixed argv.
	if err != nil {
		return "unknown commit"
	}
	status, _ := exec.CommandContext(context.Background(), "git", "-C", dir, "status", "--porcelain").Output() // #nosec G204 -- fixed argv.
	return fmt.Sprintf("%s + %d local changes", strings.TrimSpace(string(commit)), strings.Count(string(status), "\n"))
}
