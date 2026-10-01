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
	if len(a.NewInert) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d file(s) enforce no scenario at all (nothing in them is tagged @unit/@integration/@e2e/@regression)", len(a.NewInert)))
	}
	if len(a.StaleInert) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d file(s) in LEGACY_INERT now enforce scenarios — remove them from the list: %s",
			len(a.StaleInert), strings.Join(a.StaleInert, ", ")))
	}
	if len(a.NewPartial) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d file(s) mix enforced scenarios with untagged ones — tag the untagged scenarios (@unit/@integration/@e2e/@regression, or @unimplemented for a tracked gap), delete them, or add the file to LEGACY_PARTIAL with a reason: %s",
			len(a.NewPartial), joinMap(a.NewPartial, func(r PartialReport) string { return fmt.Sprintf("%s (%d untagged)", r.Feature, r.Untagged) })))
	}
	if len(a.StalePartial) > 0 {
		reasons = append(reasons, fmt.Sprintf("%d file(s) in LEGACY_PARTIAL are now fully tagged — remove them from the list: %s",
			len(a.StalePartial), strings.Join(a.StalePartial, ", ")))
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
	for _, r := range a.Enforced {
		printEnforced(w, r)
	}

	if len(a.Legacy) > 0 {
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

	if len(a.ExemptInert) > 0 {
		parked := sum(a.ExemptInert, func(r InertReport) int { return r.Unimplemented })
		tail := "."
		if parked > 0 {
			tail = fmt.Sprintf(" (%d of them parked as @unimplemented).", parked)
		}
		fmt.Fprintln(w, "\nInert (no enforced scenarios — tolerated via LEGACY_INERT):")
		fmt.Fprintf(w, "  %d file(s) hold %d scenario(s) this check cannot see%s\n", len(a.ExemptInert),
			sum(a.ExemptInert, func(r InertReport) int { return r.TotalScenarios }), tail)
		fmt.Fprintln(w, "  Tag them @unit/@integration to measure them, or @unimplemented to declare the gap. See dev/docs/TESTING_PHILOSOPHY.md.")
	}

	if len(a.NewInert) > 0 {
		fmt.Fprintln(w, "\nFeature files that enforce no scenario at all:")
		for _, r := range a.NewInert {
			fmt.Fprintf(w, "  ✗ %s\n      %s\n", r.Feature, describeInert(r))
			fmt.Fprintln(w, "      Tag the scenarios @unit / @integration / @e2e / @regression and bind them, or add this file to LEGACY_INERT with a reason.")
		}
	}

	for _, l := range FormatUnknownAnnotations(a.Unknown) {
		fmt.Fprintln(w, l)
	}
}

func printOK(w io.Writer, a Analysis) {
	fmt.Fprintf(w, "\nOK: %d enforced scenario(s) bound across %d file(s).\n",
		sum(a.Enforced, func(r Report) int { return len(r.Scenarios) }), len(a.Enforced))
	if len(a.Legacy) > 0 {
		fmt.Fprintf(w, "    %d unbound scenario(s) tolerated in %d legacy file(s).\n",
			sum(a.Legacy, func(r LegacyReport) int { return r.Unbound }), len(a.Legacy))
	}
	if len(a.ExemptInert) > 0 {
		fmt.Fprintf(w, "    %d file(s) exempted via LEGACY_INERT enforce nothing at all — %d scenario(s) are invisible to this check.\n",
			len(a.ExemptInert), sum(a.ExemptInert, func(r InertReport) int { return r.TotalScenarios }))
	}
	if len(a.ExemptPartial) > 0 {
		fmt.Fprintf(w, "    %d partially-tagged file(s) exempted via LEGACY_PARTIAL — %d scenario(s) untagged and unmeasured beside their enforced ones.\n",
			len(a.ExemptPartial), sum(a.ExemptPartial, func(r PartialReport) int { return r.Untagged }))
	}
}
