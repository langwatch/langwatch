//go:build !darwin

package system

import (
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// loadAverage reads the first field of /proc/loadavg; -1 where there is none.
func loadAverage() float64 {
	raw, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return -1
	}
	return domain.ParseProcLoadavg(string(raw))
}
