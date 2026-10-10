package sources

import "fmt"

// How a number is spelled on a panel. The viewer's whole reason to exist is
// that a person reads it at a glance, so a byte count is not 1610612736 and a
// rate is not 0.016666666666666666.

// FormatValue spells one sample for a person, given the unit its query
// produces. An unknown unit falls back to three significant-ish digits, which
// is what a bare gauge wants.
func FormatValue(value float64, unit string) string {
	switch unit {
	case "bytes":
		return humanBytes(value)
	case "s":
		return formatSeconds(value)
	case "/s":
		return fmt.Sprintf("%.1f/s", value)
	case "cores":
		return fmt.Sprintf("%.2f cores", value)
	}
	if value == float64(int64(value)) {
		return fmt.Sprintf("%d", int64(value))
	}
	return fmt.Sprintf("%.2f", value)
}

// formatSeconds spells a duration-shaped sample in the unit a reader expects
// at that magnitude: sub-second latencies in milliseconds, the rest in seconds.
func formatSeconds(value float64) string {
	if value < 1 {
		return fmt.Sprintf("%.0f ms", value*1000)
	}
	return fmt.Sprintf("%.2f s", value)
}

// byteUnits are the powers of 1024 a local footprint ever reaches.
var byteUnits = []string{"B", "KB", "MB", "GB", "TB"}

func humanBytes(value float64) string {
	unit := 0
	for value >= 1024 && unit < len(byteUnits)-1 {
		value /= 1024
		unit++
	}
	if unit == 0 {
		return fmt.Sprintf("%.0f B", value)
	}
	return fmt.Sprintf("%.1f %s", value, byteUnits[unit])
}
