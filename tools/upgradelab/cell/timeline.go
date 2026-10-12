package cell

import (
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"
)

const ribbonWidth = 60

type ribbonRow struct {
	label    string
	from, to int64 // ms from origin; to == from is a point in time
}

// Ribbon draws the api phases, the cell's marks and each ledger step on one time axis, so a reader
// sees when each happened. Steps without a parsable timestamp are left out.
func Ribbon(report *Report, origin time.Time, steps []LedgerRow) string {
	var rows []ribbonRow
	for index, phase := range report.Phases {
		end := phase.AtMs
		if index+1 < len(report.Phases) {
			end = report.Phases[index+1].AtMs
		}
		rows = append(rows, ribbonRow{"api " + phase.Phase, phase.AtMs, end})
	}
	for _, name := range slices.Sorted(maps.Keys(report.Marks)) {
		rows = append(rows, ribbonRow{name, report.Marks[name], report.Marks[name]})
	}
	for _, step := range steps {
		start, ok1 := ledgerMs(step.Started, origin)
		end, ok2 := ledgerMs(step.Finished, origin)
		if ok1 && ok2 && end >= start {
			rows = append(rows, ribbonRow{"step " + step.ID, start, end})
		}
	}
	return drawRibbon(rows)
}

func drawRibbon(rows []ribbonRow) string {
	if len(rows) == 0 {
		return ""
	}
	slices.SortStableFunc(rows, func(a, b ribbonRow) int { return int(a.from - b.from) })
	last := int64(1)
	for _, row := range rows {
		last = max(last, row.to, row.from)
	}
	column := func(ms int64) int { return int(max(0, ms) * (ribbonWidth - 1) / last) }
	var text strings.Builder
	fmt.Fprintf(&text, "```\n%-44s 0 ms%s%d ms\n", "", strings.Repeat(" ", ribbonWidth-len(fmt.Sprint(last))-6), last)
	for _, row := range rows {
		bar := []byte(strings.Repeat(".", ribbonWidth))
		for at := column(row.from); at <= column(row.to); at++ {
			bar[at] = '='
		}
		if row.from == row.to {
			bar[column(row.from)] = '*'
		}
		fmt.Fprintf(&text, "%-44.44s |%s| %d-%d\n", row.label, bar, row.from, row.to)
	}
	text.WriteString("```\n")
	return text.String()
}

// ledgerMs reads a Postgres timestamp text as ms from origin. shortcut: zone-less text is read as UTC, fine while the stores run in UTC.
func ledgerMs(text string, origin time.Time) (int64, bool) {
	for _, layout := range []string{"2006-01-02 15:04:05.999999999-07", "2006-01-02 15:04:05.999999999-07:00", "2006-01-02 15:04:05.999999999"} {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.Sub(origin).Milliseconds(), true
		}
	}
	return 0, false
}
