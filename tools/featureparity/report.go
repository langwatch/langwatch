package featureparity

import (
	"fmt"
	"io"
	"slices"
	"strings"
)

// icuOrder is ICU root collation's primary order over printable ASCII, which
// Node's localeCompare uses; letters differ from their capitals only at the
// tertiary level, lowercase first.
const icuOrder = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz"

func collationKeys(s string) (primary, tertiary []int) {
	for _, r := range s {
		t := 0
		if r >= 'A' && r <= 'Z' {
			r, t = r+'a'-'A', 1
		}
		p := strings.IndexRune(icuOrder, r)
		if r > 0x7E || p < 0 {
			p = len(icuOrder) + int(r) // ponytail: code-point order past ASCII; paths are ASCII today
		}
		primary, tertiary = append(primary, p), append(tertiary, t)
	}
	return primary, tertiary
}

// localeCompare orders strings as Node's String.prototype.localeCompare does.
func localeCompare(a, b string) int {
	pa, ta := collationKeys(a)
	pb, tb := collationKeys(b)
	if c := slices.Compare(pa, pb); c != 0 {
		return c
	}
	return slices.Compare(ta, tb)
}

// FormatFailureBanner is the verdict printed above the per-file sections.
func FormatFailureBanner(reasons []string) []string {
	if len(reasons) == 0 {
		return nil
	}
	return []string{
		"\n✗ THIS RUN FAILS: " + strings.Join(reasons, ", ") + ".",
		"  A ✓ below means that feature file is fully bound, not that the run passed.",
	}
}

// FormatUnknownAnnotations groups unknown annotations under their test file.
func FormatUnknownAnnotations(unknown []Binding) []string {
	if len(unknown) == 0 {
		return nil
	}
	lines := []string{"\nAnnotations referencing unknown scenarios (typo? renamed scenario? stale binding?):"}
	var files []string
	byFile := map[string][]Binding{}
	for _, a := range unknown {
		if _, ok := byFile[a.Ref.File]; !ok {
			files = append(files, a.Ref.File)
		}
		byFile[a.Ref.File] = append(byFile[a.Ref.File], a)
	}
	slices.SortStableFunc(files, localeCompare)
	for _, f := range files {
		lines = append(lines, "\n  ▸ "+f)
		for _, a := range byFile[f] {
			lines = append(lines, "    ✗ @scenario "+a.Title, fmt.Sprintf("      line %d", a.Ref.Line))
		}
	}
	return lines
}

func describeInert(r InertReport) string {
	head := fmt.Sprintf("0 of %d scenario(s) enforced", r.TotalScenarios)
	switch r.Unimplemented {
	case 0:
		return head + " — none tagged @unit/@integration/@e2e/@regression"
	case r.TotalScenarios:
		return head + " — every scenario is @unimplemented"
	}
	return fmt.Sprintf("%s — %d @unimplemented, the rest untagged", head, r.Unimplemented)
}

func sum[T any](items []T, f func(T) int) int {
	n := 0
	for _, it := range items {
		n += f(it)
	}
	return n
}

func joinMap[T any](items []T, f func(T) string) string {
	parts := make([]string, len(items))
	for i, it := range items {
		parts[i] = f(it)
	}
	return strings.Join(parts, ", ")
}

// FatalReasons are why the run fails; empty means it passes.
func FatalReasons(a Analysis) []string {
	var reasons []string
	if n := sum(a.Enforced, func(r Report) int { return len(r.Unbound) }); n > 0 {
		reasons = append(reasons, fmt.Sprintf("%d unbound scenario(s) in enforced files", n))
	}
	if len(a.Unknown) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d unknown annotation(s)", len(a.Unknown)))
	}
	if len(a.StaleLegacy) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d fully-bound file(s) still in LEGACY_UNBOUND — remove them from the list: %s",
			len(a.StaleLegacy), joinMap(a.StaleLegacy, func(r LegacyReport) string { return r.Feature })))
	}
	if n := len(a.AnnotationsOnUntagged.Fresh); n > 0 {
		reasons = append(reasons, fmt.Sprintf("%d @scenario annotation(s) bind a scenario carrying no binding tag — tag the scenario with the lane its test runs in", n))
	}
	if n := len(a.Untagged.Fresh); n > 0 {
		reasons = append(reasons, fmt.Sprintf("%d scenario(s) carry no binding tag — tag them @unit/@integration/@e2e/@regression and bind them, tag them @unimplemented with an issue, or delete them", n))
	}
	if n := len(a.UnimplementedWithoutIssue.Fresh); n > 0 {
		reasons = append(reasons, fmt.Sprintf("%d @unimplemented scenario(s) cite no tracked issue — add an @issue:<number> tag or a #<number> comment directly above", n))
	}
	if n := len(a.Untagged.Stale) + len(a.UnimplementedWithoutIssue.Stale) + len(a.AnnotationsOnUntagged.Stale); n > 0 {
		reasons = append(reasons, fmt.Sprintf("%d frozen scenario entr(y/ies) no longer apply — remove them from %s", n, frozenRelative))
	}
	if len(a.ListErrors) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d exemption-list error(s)", len(a.ListErrors)))
	}
	return reasons
}

func printEnforced(w io.Writer, r Report) {
	total := len(r.Scenarios)
	bound := total - len(r.Unbound)
	fmt.Fprintf(w, "\n▸ %s\n", r.Feature)
	if isInert(r) {
		fmt.Fprintf(w, "  %s\n", describeInert(toInert(r)))
		return
	}
	if r.UntaggedScenarios > 0 {
		fmt.Fprintf(w, "  %d/%d tagged scenario(s) bound · %d scenario(s) untagged and unmeasured\n", bound, total, r.UntaggedScenarios)
	} else {
		fmt.Fprintf(w, "  %d/%d scenarios bound\n", bound, total)
	}
	if total == 0 {
		fmt.Fprintln(w, "  · no scenarios declared")
		return
	}
	if len(r.Unbound) == 0 {
		fmt.Fprintln(w, "  ✓ all bound")
		return
	}
	fmt.Fprintln(w, "\n  Unbound scenarios:")
	for _, s := range r.Unbound {
		fmt.Fprintf(w, "    ✗ [%s] %s\n", strings.Join(s.Tags, " "), s.Title)
		fmt.Fprintf(w, "      %s:%d\n", r.Feature, s.Line)
		fmt.Fprintf(w, "      Add: /** @scenario %s */ above an it(...) test, or # @scenario \"%s\" above an @test in a .bats file\n", s.Title, s.Title)
	}
}

// PrintReport writes the human-readable report.
func PrintReport(w io.Writer, a Analysis) {
	fmt.Fprintln(w, "Feature-file parity check")
	fmt.Fprintln(w, "=========================")
	fmt.Fprintf(w, "Enforced: %d file(s) · Legacy: %d file(s) · Inert: %d file(s)\n", len(a.Enforced), len(a.Legacy), len(a.Inert))
	for _, l := range FormatFailureBanner(FatalReasons(a)) {
		fmt.Fprintln(w, l)
	}
	for i := range a.Enforced {
		printEnforced(w, a.Enforced[i])
	}

	printLegacy(w, a)
	printInert(w, a)

	for _, l := range FormatUnknownAnnotations(a.Unknown) {
		fmt.Fprintln(w, l)
	}
	for _, l := range FormatAnnotationsOnUntagged(a.AnnotationsOnUntagged.Fresh) {
		fmt.Fprintln(w, l)
	}
	for _, l := range FormatFrozenFailures(a) {
		fmt.Fprintln(w, l)
	}
}

// printLegacy prints the tolerated legacy files and how far each is bound.
func printLegacy(w io.Writer, a Analysis) {
	if len(a.Legacy) == 0 {
		return
	}
	fmt.Fprintln(w, "\nLegacy (tolerated — not failing CI):")
	fmt.Fprintf(w, "  %d file(s), %d/%d bound, %d unbound\n", len(a.Legacy),
		sum(a.Legacy, func(r LegacyReport) int { return r.Bound }),
		sum(a.Legacy, func(r LegacyReport) int { return r.Total }),
		sum(a.Legacy, func(r LegacyReport) int { return r.Unbound }))
	for _, r := range a.Legacy {
		fmt.Fprintf(w, "  · %s  %d/%d bound, %d unbound\n", r.Feature, r.Bound, r.Total, r.Unbound)
	}
	fmt.Fprintln(w, "\n  Shrink this list by binding scenarios, flagging @unimplemented, or removing stale scenarios. See dev/docs/TESTING_PHILOSOPHY.md.")
}

// printInert prints the files that enforce no scenario, so the blind spot stays visible.
func printInert(w io.Writer, a Analysis) {
	if len(a.Inert) == 0 {
		return
	}
	parked := sum(a.Inert, func(r InertReport) int { return r.Unimplemented })
	tail := "."
	if parked > 0 {
		tail = fmt.Sprintf(" (%d of them parked as @unimplemented).", parked)
	}
	fmt.Fprintln(w, "\nInert (no enforced scenarios):")
	fmt.Fprintf(w, "  %d file(s) hold %d scenario(s) this check cannot see%s\n", len(a.Inert),
		sum(a.Inert, func(r InertReport) int { return r.TotalScenarios }), tail)
	fmt.Fprintln(w, "  Tag them @unit/@integration to measure them, or @unimplemented with an issue to declare the gap. See dev/docs/TESTING_PHILOSOPHY.md.")
}

// FormatAnnotationsOnUntagged lists the annotations that bind a scenario with no binding tag.
func FormatAnnotationsOnUntagged(found []AnnotationOnUntagged) []string {
	if len(found) == 0 {
		return nil
	}
	lines := []string{"\nAnnotations binding a scenario that carries no binding tag:"}
	for _, a := range found {
		lines = append(lines, fmt.Sprintf("  ✗ %s:%d @scenario %s", a.Ref.File, a.Ref.Line, quoted(a.Title)))
		if a.Parked {
			lines = append(lines, fmt.Sprintf("      binds %s:%d, which is @unimplemented and missing %s. Replace @unimplemented with %s (the lane the test runs in), or remove the annotation.", a.Scenario.Feature, a.Scenario.Line, a.MissingTag, a.MissingTag))
		} else {
			lines = append(lines, fmt.Sprintf("      binds %s:%d, which is missing %s. Add %s (the lane the test runs in) to that scenario, or remove the annotation.", a.Scenario.Feature, a.Scenario.Line, a.MissingTag, a.MissingTag))
		}
	}
	return lines
}

// quoted wraps s in double quotes verbatim, with no escaping, so the text
// matches the Node tool's output byte for byte (%q would escape).
func quoted(s string) string { return "\"" + s + "\"" }

// FormatFrozenFailures lists the scenarios the frozen file does not cover and
// the frozen entries that no longer apply.
func FormatFrozenFailures(a Analysis) []string {
	var lines []string
	lines = append(lines, formatFreshUntagged(a.Untagged.Fresh)...)
	lines = append(lines, formatFreshUnimplemented(a.UnimplementedWithoutIssue.Fresh)...)
	for _, stale := range []struct {
		list string
		refs []ScenarioRef
	}{{"untagged", a.Untagged.Stale}, {"unimplementedWithoutIssue", a.UnimplementedWithoutIssue.Stale}, {"annotatedUntagged", a.AnnotationsOnUntagged.Stale}} {
		lines = append(lines, formatStale(stale.list, stale.refs)...)
	}
	return lines
}

func formatFreshUntagged(fresh []ScenarioRef) []string {
	if len(fresh) == 0 {
		return nil
	}
	lines := []string{"\nScenarios carrying no binding tag:"}
	for _, s := range fresh {
		lines = append(lines, fmt.Sprintf("  ✗ %s:%d %s", s.Feature, s.Line, quoted(s.Title)),
			fmt.Sprintf("      Tag it @unit / @integration / @e2e / @regression and bind a test with /** @scenario %s */, tag it @unimplemented with an @issue:<number> tag, or delete it.", quoted(s.Title)))
	}
	return lines
}

func formatFreshUnimplemented(fresh []ScenarioRef) []string {
	if len(fresh) == 0 {
		return nil
	}
	lines := []string{"\n@unimplemented scenarios citing no tracked issue:"}
	for _, s := range fresh {
		lines = append(lines, fmt.Sprintf("  ✗ %s:%d %s", s.Feature, s.Line, quoted(s.Title)),
			"      Add an @issue:<number> tag to it, or a comment line directly above its tags naming #<number>.")
	}
	return lines
}

func formatStale(list string, refs []ScenarioRef) []string {
	if len(refs) == 0 {
		return nil
	}
	lines := []string{fmt.Sprintf("\nFrozen entries that no longer apply (remove them from %s in %s):", quoted(list), frozenRelative)}
	for _, s := range refs {
		lines = append(lines, fmt.Sprintf("  ✗ %s %s", s.Feature, quoted(s.Title)))
	}
	return lines
}

func printOK(w io.Writer, a Analysis) {
	fmt.Fprintf(w, "\nOK: %d enforced scenario(s) bound across %d file(s).\n",
		sum(a.Enforced, func(r Report) int { return len(r.Scenarios) }), len(a.Enforced))
	if len(a.Legacy) > 0 {
		fmt.Fprintf(w, "    %d unbound scenario(s) tolerated in %d legacy file(s).\n",
			sum(a.Legacy, func(r LegacyReport) int { return r.Unbound }), len(a.Legacy))
	}
	if a.Untagged.Tolerated > 0 {
		fmt.Fprintf(w, "    %d untagged scenario(s) tolerated by name in %s, invisible to this check.\n", a.Untagged.Tolerated, frozenRelative)
	}
	if a.UnimplementedWithoutIssue.Tolerated > 0 {
		fmt.Fprintf(w, "    %d @unimplemented scenario(s) citing no issue tolerated by name in the same file.\n", a.UnimplementedWithoutIssue.Tolerated)
	}
	if a.AnnotationsOnUntagged.Tolerated > 0 {
		fmt.Fprintf(w, "    %d @scenario annotation(s) on a scenario with no binding tag tolerated by name in the same file.\n", a.AnnotationsOnUntagged.Tolerated)
	}
}
