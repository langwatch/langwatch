package prunetui

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// displayName is a worktree's label (slug, else directory basename); dbChips are
// its owned-database chips. Both delegate to the shared domain formatters so the
// picker and the non-interactive report label worktrees identically.
func displayName(r Row) string { return domain.SlugOrBase(r.Slug, r.Dir) }
func dbChips(r Row) string     { return domain.DBChips(r.HasCHDB, r.HasPGDB) }

// pathPreview shortens a worktree path to its last two segments, so the inline
// preview shows where it lives without the full absolute path.
func pathPreview(dir string) string {
	segs := strings.Split(strings.Trim(dir, "/"), "/")
	if len(segs) <= 2 {
		return dir
	}
	return "…/" + strings.Join(segs[len(segs)-2:], "/")
}

// reclaimDetail spells out, for the highlighted worktree, exactly what deleting it
// reclaims: its disk size and each per-slug database, plus why it is a candidate.
func reclaimDetail(r Row) string {
	size := "size …"
	if r.SizeKnown {
		size = domain.HumanBytes(r.DiskBytes) + " disk"
	}
	parts := []string{size}
	if r.HasCHDB {
		parts = append(parts, "ClickHouse "+domain.DatabaseForSlug(r.Slug))
	}
	if r.HasPGDB {
		parts = append(parts, "Postgres "+domain.DatabaseForSlug(r.Slug))
	}
	if r.RedisDB >= 0 {
		parts = append(parts, fmt.Sprintf("redis db %d", r.RedisDB))
	}
	if r.OriginGone {
		parts = append(parts, "branch merged + deleted upstream")
	}
	return strings.Join(parts, " · ")
}

// countLines counts the rendered lines in s (each ends with "\n").
func countLines(s string) int { return strings.Count(s, "\n") }

// clampLines truncates every line to w display cells (ANSI-aware) so no line can
// soft-wrap and push the layout past the terminal height. Newlines are preserved,
// so it never changes the line count View budgeted for.
func clampLines(s string, w int) string {
	if w <= 0 {
		return s
	}
	clamp := lipgloss.NewStyle().MaxWidth(w)
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		lines[i] = clamp.Render(ln)
	}
	return strings.Join(lines, "\n")
}

// truncate bounds a cell to n runes so one long name can't shear the layout.
func truncate(s string, n int) string {
	if n < 1 {
		n = 1
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}

// oneLine flattens a multi-line error to a single line for a status cell.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
