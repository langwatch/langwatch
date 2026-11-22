//go:build darwin

package system

import (
	"encoding/binary"

	"golang.org/x/sys/unix"
)

// loadAverage reads vm.loadavg: three fixed-point uint32 averages, then the
// scale as a long at offset 16 (struct loadavg in sys/resource.h).
func loadAverage() float64 {
	raw, err := unix.SysctlRaw("vm.loadavg")
	if err != nil || len(raw) < 24 {
		return -1
	}
	scale := binary.LittleEndian.Uint64(raw[16:24])
	if scale == 0 {
		return -1
	}
	return float64(binary.LittleEndian.Uint32(raw[0:4])) / float64(scale)
}
