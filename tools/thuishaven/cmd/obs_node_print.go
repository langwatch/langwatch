package cmd

import (
	"fmt"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/langwatch/langwatch/tools/thuishaven/domain/nodeprofile"
)

// The profile printers write for an agent first: plain aligned columns, no
// escape codes, every number with its unit in the line or the column head,
// the saved file's path on a line of its own, and the next command at the end.

const nameWidth = 44

func printTarget(w io.Writer, verb string, t profileTarget) {
	line := fmt.Sprintf("haven obs %s: %s lane, pid %d, stack %s", verb, t.Lane, t.PID, t.Stack)
	if len(t.Also) > 0 {
		line += " (the same process serves " + strings.Join(t.Also, ", ") + ")"
	}
	fmt.Fprintln(w, line)
}

func printSaved(w io.Writer, opensIn, path string) {
	fmt.Fprintf(w, "saved, opens in %s:\n%s\n", opensIn, path)
}

func printMemoryLine(w io.Writer, m *memoryMB) {
	if m == nil {
		return
	}
	fmt.Fprintf(w, "memory    rss %.0f MB   heap used %.0f MB of %.0f MB   external %.0f MB\n", m.RSS, m.HeapUsed, m.HeapTotal, m.External)
}

func printLoadLine(w io.Writer, l *loadRun) {
	if l == nil {
		return
	}
	line := fmt.Sprintf("load      telemetry %s at %g batches/s: sent %d, acked %d, failed %d", l.Preset, l.Rate, l.Sent, l.Acked, l.Failed)
	if l.Error != "" {
		line += "; error: " + l.Error
	}
	fmt.Fprintln(w, line)
}

func printCPUReport(w io.Writer, r cpuReport) {
	s := r.Summary
	printTarget(w, "cpu", r.profileTarget)
	printSaved(w, "Chrome DevTools > Performance > Load profile", r.Profile)
	fmt.Fprintf(w, "window    %.1f s   samples %d   interval %.0f us\n", s.DurationMs/1000, s.Samples, s.IntervalUs)
	fmt.Fprintf(w, "cpu       busy %.1f %%   gc %.1f %%   program %.1f %%   idle %.1f %%\n", s.BusyPct, s.GCPct, s.ProgramPct, s.IdlePct)
	printMemoryLine(w, r.Memory)
	printLoadLine(w, r.Load)
	fmt.Fprintf(w, "inspector %s\n", r.Inspector)
	printRows(w, rowTable{"self time by function", s.ByFunction, true})
	printRows(w, rowTable{"self time by package", s.ByPackage, false})
	printRows(w, rowTable{"self time by file", s.ByFile, false})
	printRows(w, rowTable{"inclusive time by function (self + callees)", s.Inclusive, true})
	fmt.Fprintf(w, "\nnext: change the code, run haven obs cpu %s again, then haven obs compare %s\n", r.Lane, r.Lane)
}

// rowTable is one time table: its title, rows, and whether rows name a place.
type rowTable struct {
	title     string
	rows      []nodeprofile.Row
	withWhere bool
}

func printRows(w io.Writer, t rowTable) {
	fmt.Fprintf(w, "\n%s\n", t.title)
	if len(t.rows) == 0 {
		fmt.Fprintln(w, "  (no samples)")
		return
	}
	head := fmt.Sprintf("  %9s %6s  %s", "ms", "%", "name")
	if t.withWhere {
		head = fmt.Sprintf("  %9s %6s  %-*s  %s", "ms", "%", nameWidth, "function", "where")
	}
	fmt.Fprintln(w, head)
	for _, r := range t.rows {
		if t.withWhere {
			fmt.Fprintf(w, "  %9.0f %6.2f  %-*s  %s\n", r.Ms, r.Pct, nameWidth, fit(r.Name, nameWidth), r.Where)
			continue
		}
		fmt.Fprintf(w, "  %9.0f %6.2f  %s\n", r.Ms, r.Pct, r.Name)
	}
}

func printHeapReport(w io.Writer, r heapReport) {
	printTarget(w, "heap", r.profileTarget)
	if r.Snapshot != nil {
		printSaved(w, "Chrome DevTools > Memory > Load profile", r.Profile)
		printSnapshot(w, r)
		return
	}
	printSaved(w, "Chrome DevTools > Memory > Load profile", r.Profile)
	a := r.Sampling
	what := "allocated over the window, collected objects included"
	if r.Mode == "live" {
		what = "still alive at the end of the window"
	}
	fmt.Fprintf(w, "window    %.1f s   sampled %.1f MB %s\n", r.WindowMs/1000, a.TotalMB, what)
	printMemoryLine(w, r.Memory)
	printLoadLine(w, r.Load)
	fmt.Fprintf(w, "inspector %s\n", r.Inspector)
	printSizes(w, sizeTable{title: "sampled heap by function", rows: a.ByFunction, withWhere: true})
	printSizes(w, sizeTable{title: "sampled heap by package", rows: a.ByPackage})
	printSizes(w, sizeTable{title: "sampled heap by file", rows: a.ByFile})
	fmt.Fprintf(w, "\nnext: haven obs heap %s --snapshot for what is retained, and by whom\n", r.Lane)
}

// sizeTable is one memory table: its title, rows, and which columns it has.
type sizeTable struct {
	title                string
	rows                 []nodeprofile.SizeRow
	withWhere, withCount bool
}

func (t sizeTable) count(r nodeprofile.SizeRow) string {
	if !t.withCount {
		return ""
	}
	return fmt.Sprintf(" %9d", r.Count)
}

func printSizes(w io.Writer, t sizeTable) {
	fmt.Fprintf(w, "\n%s\n", t.title)
	if len(t.rows) == 0 {
		fmt.Fprintln(w, "  (nothing)")
		return
	}
	countHead := ""
	if t.withCount {
		countHead = fmt.Sprintf(" %9s", "objects")
	}
	if t.withWhere {
		fmt.Fprintf(w, "  %8s %6s%s  %-*s  %s\n", "MB", "%", countHead, nameWidth, "function", "where")
	} else {
		fmt.Fprintf(w, "  %8s %6s%s  %s\n", "MB", "%", countHead, "name")
	}
	count := t.count
	for _, r := range t.rows {
		if t.withWhere {
			fmt.Fprintf(w, "  %8.1f %6.2f%s  %-*s  %s\n", r.MB, r.Pct, count(r), nameWidth, fit(r.Name, nameWidth), r.Where)
			continue
		}
		fmt.Fprintf(w, "  %8.1f %6.2f%s  %s\n", r.MB, r.Pct, count(r), r.Name)
	}
}

func printSnapshot(w io.Writer, r heapReport) {
	a := r.Snapshot
	fmt.Fprintf(w, "heap      %.1f MB self size in %d objects; the process paused %.1f s for the snapshot\n", a.TotalMB, a.Nodes, r.PauseMs/1000)
	printMemoryLine(w, r.Memory)
	fmt.Fprintf(w, "inspector %s\n", r.Inspector)
	printSizes(w, sizeTable{title: "self size by type", rows: a.ByType, withCount: true})
	printSizes(w, sizeTable{title: "self size by constructor", rows: a.ByConstructor, withCount: true})
	printSizes(w, sizeTable{title: "retained size by constructor (outermost of a nest)", rows: a.RetainedByConstructor, withCount: true})
	fmt.Fprintln(w, "\nbiggest holders (retained; path is the dominator chain, nearest first)")
	if len(a.TopRetained) == 0 {
		fmt.Fprintln(w, "  (none over 1 MB)")
	}
	fmt.Fprintf(w, "  %8s  %s\n", "MB", "object  <- held via")
	for _, h := range a.TopRetained {
		fmt.Fprintf(w, "  %8.1f  %s:%s  <- %s\n", h.MB, h.Type, h.Name, h.Path)
	}
	st := a.Strings
	fmt.Fprintf(w, "\nstrings   %.1f MB in %d; two-byte (a character above U+00FF, 2 bytes a character) %.1f MB in %d\n", st.MB, st.Count, st.TwoByteMB, st.TwoByteCount)
	fmt.Fprintf(w, "  %8s %7s  %-8s  %s\n", "MB", "count", "encoding", "first 60 characters")
	for _, s := range st.Biggest {
		enc := "1-byte"
		if s.TwoByte {
			enc = "2-byte"
		}
		fmt.Fprintf(w, "  %8.1f %7d  %-8s  %q\n", s.MB, s.Count, enc, s.Preview)
	}
	fmt.Fprintln(w, "\nnpm packages loaded from more than one pnpm directory")
	if len(a.DuplicatePackages) == 0 {
		fmt.Fprintln(w, "  (none)")
	}
	for _, p := range a.DuplicatePackages {
		fmt.Fprintf(w, "  %-32s %5d modules  %s\n", p.Name, p.Modules, strings.Join(p.Dirs, "  "))
	}
}

func printCompareReport(w io.Writer, r compareReport) {
	c := r.Diff
	fmt.Fprintln(w, "haven obs compare: before -> after")
	fmt.Fprintf(w, "before    %.1f s   busy %.1f %%   gc %.1f %%\n%s\n", c.Before.DurationMs/1000, c.Before.BusyPct, c.Before.GCPct, r.Before)
	fmt.Fprintf(w, "after     %.1f s   busy %.1f %%   gc %.1f %%\n%s\n", c.After.DurationMs/1000, c.After.BusyPct, c.After.GCPct, r.After)
	fmt.Fprintf(w, "change    busy %+.1f pt   gc %+.1f pt   (pt: percentage points of each profile's window)\n", c.BusyDelta, c.GCDelta)
	printDeltas(w, deltaTable{"self time by function, biggest change first", c.ByFunction, true})
	printDeltas(w, deltaTable{"self time by package, biggest change first", c.ByPackage, false})
}

// deltaTable is one comparison table: its title, rows, and whether rows name a place.
type deltaTable struct {
	title     string
	rows      []nodeprofile.Delta
	withWhere bool
}

func printDeltas(w io.Writer, t deltaTable) {
	fmt.Fprintf(w, "\n%s\n", t.title)
	if len(t.rows) == 0 {
		fmt.Fprintln(w, "  (no samples)")
		return
	}
	if t.withWhere {
		fmt.Fprintf(w, "  %8s %8s %9s  %-*s  %s\n", "before %", "after %", "change pt", nameWidth, "function", "where")
	} else {
		fmt.Fprintf(w, "  %8s %8s %9s  %s\n", "before %", "after %", "change pt", "package")
	}
	for _, d := range t.rows {
		if t.withWhere {
			fmt.Fprintf(w, "  %8.2f %8.2f %+9.2f  %-*s  %s\n", d.BeforePct, d.AfterPct, d.DeltaPct, nameWidth, fit(d.Name, nameWidth), d.Where)
			continue
		}
		fmt.Fprintf(w, "  %8.2f %8.2f %+9.2f  %s\n", d.BeforePct, d.AfterPct, d.DeltaPct, d.Name)
	}
}

// fit cuts s to n characters, marking a cut with a trailing "~".
func fit(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "~"
}
