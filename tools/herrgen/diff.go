package herrgen

import (
	"fmt"
	"strings"
)

// diffContext is how many unchanged lines are kept either side of a change.
const diffContext = 3

// Diff renders a unified-style line diff of two texts, so a stale generated
// file shows what actually moved instead of "files differ".
func Diff(before, after string) []string {
	oldLines := strings.Split(strings.TrimSuffix(before, "\n"), "\n")
	newLines := strings.Split(strings.TrimSuffix(after, "\n"), "\n")

	return elide(edits(oldLines, newLines))
}

// edits walks the longest common subsequence, emitting each line with its
// unified-diff marker.
func edits(oldLines, newLines []string) []string {
	table := lcsTable(oldLines, newLines)

	var out []string
	i, j := 0, 0
	for i < len(oldLines) && j < len(newLines) {
		switch {
		case oldLines[i] == newLines[j]:
			out = append(out, " "+oldLines[i])
			i, j = i+1, j+1
		case table[i+1][j] >= table[i][j+1]:
			out = append(out, "-"+oldLines[i])
			i++
		default:
			out = append(out, "+"+newLines[j])
			j++
		}
	}
	for ; i < len(oldLines); i++ {
		out = append(out, "-"+oldLines[i])
	}
	for ; j < len(newLines); j++ {
		out = append(out, "+"+newLines[j])
	}
	return out
}

// lcsTable is the standard longest-common-subsequence length table, filled from
// the end so table[i][j] is the LCS of the suffixes starting at i and j.
func lcsTable(oldLines, newLines []string) [][]int {
	table := make([][]int, len(oldLines)+1)
	for i := range table {
		table[i] = make([]int, len(newLines)+1)
	}
	for i := len(oldLines) - 1; i >= 0; i-- {
		for j := len(newLines) - 1; j >= 0; j-- {
			if oldLines[i] == newLines[j] {
				table[i][j] = table[i+1][j+1] + 1
				continue
			}
			table[i][j] = max(table[i+1][j], table[i][j+1])
		}
	}
	return table
}

// elide drops runs of unchanged lines longer than twice the context, so the
// output stays readable when a 300-line file gained one code.
func elide(marked []string) []string {
	keep := make([]bool, len(marked))
	for index, line := range marked {
		if strings.HasPrefix(line, " ") {
			continue
		}
		for offset := max(0, index-diffContext); offset <= min(len(marked)-1, index+diffContext); offset++ {
			keep[offset] = true
		}
	}

	var out []string
	skipped := 0
	for index, line := range marked {
		if !keep[index] {
			skipped++
			continue
		}
		if skipped > 0 {
			out = append(out, fmt.Sprintf("@@ %d unchanged lines @@", skipped))
			skipped = 0
		}
		out = append(out, line)
	}
	if skipped > 0 {
		out = append(out, fmt.Sprintf("@@ %d unchanged lines @@", skipped))
	}
	return out
}
