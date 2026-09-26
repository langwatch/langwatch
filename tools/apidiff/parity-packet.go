package apidiff

import (
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

// ModuleCounts is one module's row of the parity table. Extra is branch-only
// surface: reported, never a defect.
type ModuleCounts struct {
	Module   string `json:"module"`
	Missing  int    `json:"missing"`
	Breaking int    `json:"breaking"`
	Extra    int    `json:"extra"`
}

// moduleTally accumulates the per-module rows of the parity table.
type moduleTally map[string]*ModuleCounts

func (tally moduleTally) row(module string) *ModuleCounts {
	if tally[module] == nil {
		tally[module] = &ModuleCounts{Module: module}
	}
	return tally[module]
}

func (tally moduleTally) addTrpc(trpc TrpcParity) {
	for _, gap := range trpc.Missing {
		tally.row(gap.Module).Missing++
	}
	for _, diff := range trpc.Breaking {
		tally.row(diff.Module).Breaking++
	}
	for _, gap := range trpc.Extra {
		tally.row(gap.Module).Extra++
	}
}

func (tally moduleTally) addRest(rest *RestParity) {
	if rest == nil {
		return
	}
	for _, gap := range rest.Missing {
		tally.row(gap.Module).Missing++
	}
	for index := range rest.Changed {
		if rest.Changed[index].Unruled() {
			tally.row(rest.Changed[index].Module).Breaking++
		}
	}
	for _, gap := range rest.Extra {
		tally.row(gap.Module).Extra++
	}
}

func moduleCounts(report ParityReport) []ModuleCounts {
	tally := moduleTally{}
	tally.addTrpc(report.Trpc)
	tally.addRest(report.Rest)
	rows := make([]ModuleCounts, 0, len(tally))
	for _, counts := range tally {
		rows = append(rows, *counts)
	}
	sort.Slice(rows, func(i, j int) bool {
		left, right := rows[i].Missing+rows[i].Breaking, rows[j].Missing+rows[j].Breaking
		if left != right {
			return left > right
		}
		return rows[i].Module < rows[j].Module
	})
	return rows
}

// WriteParityTable prints the module × {missing, breaking, extra} table,
// largest work first.
func WriteParityTable(writer io.Writer, report ParityReport) error {
	var output strings.Builder
	fmt.Fprintf(&output, "parity: tRPC main %d / branch %d procedures", report.Trpc.MainCount, report.Trpc.BranchCount)
	if report.Rest != nil {
		fmt.Fprintf(&output, "; REST main %d / branch %d operations", report.Rest.MainCount, report.Rest.BranchCount)
	}
	fmt.Fprintf(&output, "\n  %-28s %8s %9s %6s\n", "module", "missing", "breaking", "extra")
	total := ModuleCounts{Module: "total"}
	for _, row := range report.Modules {
		fmt.Fprintf(&output, "  %-28s %8d %9d %6d\n", row.Module, row.Missing, row.Breaking, row.Extra)
		total.Missing += row.Missing
		total.Breaking += row.Breaking
		total.Extra += row.Extra
	}
	fmt.Fprintf(&output, "  %-28s %8d %9d %6d\n", total.Module, total.Missing, total.Breaking, total.Extra)
	fmt.Fprintf(&output, "  rename candidates %d, namespace-move candidates %d, ruled owner moves %d, ruled retired %d\n", len(report.Trpc.Renamed), len(report.Trpc.Moved), len(report.Trpc.OwnerMoves), len(report.Trpc.Retired))
	for _, note := range report.Notes {
		fmt.Fprintf(&output, "  note: %s\n", note)
	}
	_, err := io.WriteString(writer, output.String())
	return err
}

// renderPacket writes one module's work packet: everything a lane needs to
// turn it into one manifest without opening parity.json.
func renderPacket(report ParityReport, module string) string {
	var output strings.Builder
	fmt.Fprintf(&output, "# Parity packet: %s\n\n", module)
	fmt.Fprintf(&output, "Main `%s` against the branch, generated %s by `apidiff run`. Main's tRPC sources are paths in the main checkout; branch sources are paths in this repository.\n\n", report.MainRef, report.GeneratedAt)
	writePacketCounts(&output, report, module)
	writeTrpcSections(&output, report.Trpc, module)
	if report.Rest != nil {
		writeRestSections(&output, *report.Rest, module)
	} else {
		output.WriteString("## REST\n\nNot compared yet: the branch document exists only once it serves. A full `apidiff run` completes this section.\n")
	}
	return output.String()
}

func writePacketCounts(output *strings.Builder, report ParityReport, module string) {
	for _, row := range report.Modules {
		if row.Module == module {
			fmt.Fprintf(output, "| missing on branch | breaking | extra on branch |\n|---|---|---|\n| %d | %d | %d |\n\n", row.Missing, row.Breaking, row.Extra)
		}
	}
}

func writeTrpcSections(output *strings.Builder, trpc TrpcParity, module string) {
	writeMissingProcedures(output, filterGaps(trpc.Missing, module))
	writeBreakingProcedures(output, trpc.Breaking, module)
	writeSection(output, "Rename candidates", pairLines(trpc.Renamed, module))
	writeSection(output, "Namespace-move candidates", pairLines(trpc.Moved, module))
	writeSection(output, "Ruled owner moves, not defects", ownerMoveLines(trpc.OwnerMoves, module))
	retired := []string{}
	for _, gap := range filterGaps(trpc.Retired, module) {
		retired = append(retired, fmt.Sprintf("- `%s` (%s) %s\n", gap.Path, gap.Kind, gap.Source))
	}
	writeSection(output, "Ruled retired, not defects", retired)
	extra := []string{}
	for _, gap := range filterGaps(trpc.Extra, module) {
		extra = append(extra, fmt.Sprintf("- `%s` (%s) %s\n", gap.Path, gap.Kind, gap.Source))
	}
	writeSection(output, "Extra on branch, not defects", extra)
}

func writeMissingProcedures(output *strings.Builder, missing []ProcedureGap) {
	if len(missing) == 0 {
		return
	}
	fmt.Fprintf(output, "## Missing tRPC procedures (%d)\n\nDeclare each in this module's contract (`defineTrpcContract`) under the same name, kind and input, then bind it.\n\n| procedure | kind | main source |\n|---|---|---|\n", len(missing))
	for _, gap := range missing {
		fmt.Fprintf(output, "| `%s` | %s | %s |\n", gap.Path, gap.Kind, gap.Source)
	}
	output.WriteString("\n")
}

func writeBreakingProcedures(output *strings.Builder, diffs []ProcedureDiff, module string) {
	lines := []string{}
	for _, diff := range diffs {
		if diff.Module != module {
			continue
		}
		lines = append(lines, fmt.Sprintf("- `%s` (branch %s, main %s)\n", diff.Path, diff.BranchSource, diff.MainSource))
		for _, change := range diff.Changes {
			lines = append(lines, fmt.Sprintf("  - %s\n", change))
		}
	}
	writeSection(output, "Breaking tRPC differences", lines)
}

func filterGaps(gaps []ProcedureGap, module string) []ProcedureGap {
	kept := []ProcedureGap{}
	for _, gap := range gaps {
		if gap.Module == module {
			kept = append(kept, gap)
		}
	}
	return kept
}

func pairLines(pairs []ProcedurePair, module string) []string {
	lines := []string{}
	for _, pair := range pairs {
		if pair.Module == module {
			lines = append(lines, fmt.Sprintf("- main `%s` may be branch `%s` (%s)\n", pair.Main, pair.Branch, pair.Reason))
		}
	}
	return lines
}

// ownerMoveLines lists the ruled moves a module gave away or took in.
func ownerMoveLines(pairs []ProcedurePair, module string) []string {
	lines := []string{}
	for _, pair := range pairs {
		if pair.Module == module || pair.MainModule == module {
			lines = append(lines, fmt.Sprintf("- main `%s` (%s) is served as branch `%s` (%s)\n", pair.Main, pair.MainModule, pair.Branch, pair.Module))
		}
	}
	return lines
}

// writeSection writes a titled list, or nothing when the list is empty.
func writeSection(output *strings.Builder, title string, lines []string) {
	if len(lines) == 0 {
		return
	}
	fmt.Fprintf(output, "## %s\n\n%s\n", title, strings.Join(lines, ""))
}

func writeRestSections(output *strings.Builder, rest RestParity, module string) {
	writeSection(output, "Missing REST operations", restGapLines(rest.Missing, module))
	writeSection(output, "Ruled retired REST operations, not defects", restGapLines(rest.Retired, module))
	breaking, ruled := []string{}, []string{}
	for index := range rest.Changed {
		diff := rest.Changed[index]
		switch {
		case diff.Module != module || !diff.Breaking:
		case diff.Ruling != "":
			ruled = append(ruled, fmt.Sprintf("- ruling: %s\n", diff.Ruling))
			ruled = append(ruled, restDiffLines(diff)...)
		default:
			breaking = append(breaking, restDiffLines(diff)...)
		}
	}
	writeSection(output, "Breaking REST differences", breaking)
	writeSection(output, "Ruled breaking REST differences, not defects", ruled)
	if statuses := notComparedStatuses(rest, module); statuses > 0 {
		fmt.Fprintf(output, "Documented error statuses differ on %d operations; parity there is not required, so they are not listed.\n", statuses)
	}
}

func restGapLines(gaps []RestGap, module string) []string {
	lines := []string{}
	for _, gap := range gaps {
		if gap.Module == module {
			lines = append(lines, fmt.Sprintf("- `%s %s` %s\n", gap.Method, gap.Path, gap.OperationID))
		}
	}
	return lines
}

// notComparedStatuses counts the module's operations whose documented error
// statuses differ: counted once, never listed (parity rulings, 2026-09-25).
func notComparedStatuses(rest RestParity, module string) int {
	count := 0
	for index := range rest.Changed {
		diff := rest.Changed[index]
		if diff.Module == module && slices.ContainsFunc(diff.Changes, isNotCompared) {
			count++
		}
	}
	return count
}

func isNotCompared(change ClassifiedChange) bool {
	return change.Class == openapidiff.ClassNotCompared
}

// restDiffLines lists an operation's breaking changes; what is additive,
// unknown or not compared stays in parity.json.
func restDiffLines(diff RestDiff) []string {
	lines := []string{fmt.Sprintf("- `%s %s`\n", diff.Method, diff.Path)}
	for index := range diff.Changes {
		change := diff.Changes[index]
		if change.Class != openapidiff.ClassBreaking {
			continue
		}
		for field, pair := range change.Fields {
			lines = append(lines, fmt.Sprintf("  - %s %s %s (%v -> %v)\n", change.Class, change.Kind, field, pair[0], pair[1]))
		}
	}
	return lines
}

// WriteParityPlan is the parity step in -dry-run's plan.
func WriteParityPlan(writer io.Writer, plan DryRunPlan) {
	fmt.Fprintf(writer, "  parity (phase one, before any stack boots; -parity-only stops after it)\n")
	fmt.Fprintf(writer, "    pnpm install + start:prepare:files in both worktrees (no workspace build)\n")
	fmt.Fprintf(writer, "    pnpm exec tsx %s (in %s/platform/app; a modular main runs like the branch), datastore URLs pointed at a closed port\n", inventoryScriptName, plan.MainDir)
	fmt.Fprintf(writer, "    node --experimental-transform-types %s (in %s/branch/packages/api)\n", inventoryScriptName, plan.WorkRoot)
	fmt.Fprintf(writer, "    write %s/parity.json and %s/parity/<module>.md\n", plan.WorkRoot, plan.WorkRoot)
}
