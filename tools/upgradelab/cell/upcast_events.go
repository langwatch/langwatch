package cell

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// OverlayUpcastEvents reads the event types main stored at the cut and judges, after settle, the stored types head
// reads through an upcast (its ledger's `upcast:<pipeline>:<stored type>` steps): each step settled, main's rows under
// it kept, and I7 refusing none (V1). Main writes these rows itself; the overlay adds no row main would not write.
const OverlayUpcastEvents = "upcast-events"

const upcastStepPrefix = "upcast:"

// storedTypeCounts reads event_log's rows per stored event type on the shared target.
func (cell *run) storedTypeCounts(ctx context.Context) (map[string]int, error) {
	out, err := clickhouseQuery(ctx, cell.stores.queryURL(""), "SELECT EventType, count() FROM event_log GROUP BY EventType FORMAT TSV")
	if err != nil {
		return nil, err
	}
	return parseTypeCounts(out)
}

func parseTypeCounts(out string) (map[string]int, error) {
	counts := map[string]int{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != 2 {
			return nil, fmt.Errorf("event_log type count line %q", line)
		}
		count, err := strconv.Atoi(fields[1])
		if err != nil {
			return nil, err
		}
		counts[fields[0]] = count
	}
	return counts, nil
}

// noteStoredTypesAtCut keeps main's stored event types once its worker is paused.
func (cell *run) noteStoredTypesAtCut(ctx context.Context) error {
	counts, err := cell.storedTypeCounts(ctx)
	if err != nil {
		return fmt.Errorf("stored event types at the cut: %w", err)
	}
	cell.typesAtCut = counts
	cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("upcast-events: main stored %d event types at the cut", len(counts)))
	return nil
}

// upcastVerdict (V1) judges head's upcast steps against main's stored rows; I7 is read from the verdicts already judged.
func (cell *run) upcastVerdict(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.overlay(OverlayUpcastEvents) {
		return nil
	}
	after, err := cell.storedTypeCounts(ctx)
	i7 := Verdict{Result: "missing"}
	if index := slices.IndexFunc(cell.report.Verdicts, func(each Verdict) bool { return each.ID == "I7" }); index >= 0 {
		i7 = cell.report.Verdicts[index]
	}
	return []Verdict{judgeUpcasts(final, cell.typesAtCut, after, i7, err)}
}

// judgeUpcasts: every upcast step done or not-needed, no stored row under an upcast type lost, and I7 passed.
// Head declaring no upcast step fails: there would be nothing to judge.
func judgeUpcasts(final []LedgerRow, atCut, after map[string]int, i7 Verdict, readErr error) Verdict {
	if readErr != nil || atCut == nil {
		return Verdict{ID: "V1", Name: invariantNames["V1"], Result: "inconclusive", Detail: "stored types unread: " + errText(errors.Join(readErr, errors.New("no reading at the cut")))}
	}
	var steps, unsettled, lost []string
	rows := 0
	for i := range final {
		row := &final[i]
		if !strings.HasPrefix(row.ID, upcastStepPrefix) {
			continue
		}
		parts := strings.SplitN(strings.TrimPrefix(row.ID, upcastStepPrefix), ":", 2)
		stored := parts[len(parts)-1]
		steps = append(steps, fmt.Sprintf("%s %s (main rows at the cut %d, after %d)", row.ID, row.Status, atCut[stored], after[stored]))
		if row.Status != "done" && row.Status != "not-needed" {
			unsettled = append(unsettled, row.ID+" "+row.Status)
		}
		if after[stored] < atCut[stored] {
			lost = append(lost, stored)
		}
		rows += atCut[stored]
	}
	pass := len(steps) > 0 && len(unsettled) == 0 && len(lost) == 0 && i7.Result == "pass"
	return verdict("V1", pass, fmt.Sprintf("%d upcast steps: %v; main rows under an upcast type at the cut %d (0: main writes none of them, so the upcasts have nothing of main's to read); unsettled %v; lost %v; I7 %s",
		len(steps), steps, rows, unsettled, lost, i7.Result))
}
