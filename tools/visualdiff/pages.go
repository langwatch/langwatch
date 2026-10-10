package visualdiff

import (
	"context"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

// MaxCheckPages caps check's pages: r12's sixteen on a shared machine ran four renderers
// to 900 MB each, held back 76 blank routes and spent 10m31s retaking them alone.
const MaxCheckPages = 4

// PageMemory is what one page's renderer is budgeted; r12 measured 450 to 900 MB.
const PageMemory int64 = 1 << 30

// CheckPages is check's default page count: MaxCheckPages, half the CPUs, and one per
// PageMemory free, never under one. The runner then backs off live under load and crashes.
func CheckPages(cpus int, free int64) int {
	pages := MaxCheckPages
	if cpus > 0 {
		pages = min(pages, cpus/2)
	}
	if free > 0 {
		pages = min(pages, int(free/PageMemory))
	}
	return max(pages, 1)
}

// readFreeMemory is the memory a new page can take without swapping, in bytes, or 0.
func readFreeMemory(ctx context.Context) int64 {
	if runtime.GOOS == "darwin" {
		// #nosec G204 -- a constant executable.
		output, err := exec.CommandContext(ctx, "vm_stat").Output()
		if err != nil {
			return 0
		}
		return ParseVMStat(string(output))
	}
	output, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	return ParseMemInfo(string(output))
}

var (
	vmStatPageSize = regexp.MustCompile(`page size of (\d+) bytes`)
	vmStatPages    = regexp.MustCompile(`(?m)^Pages (free|inactive|speculative):\s+(\d+)\.`)
	memAvailable   = regexp.MustCompile(`(?m)^MemAvailable:\s+(\d+) kB`)
)

// ParseVMStat reads macOS vm_stat's free, inactive and speculative pages as bytes, or 0.
func ParseVMStat(text string) int64 {
	size := vmStatPageSize.FindStringSubmatch(text)
	if size == nil {
		return 0
	}
	pageSize, _ := strconv.ParseInt(size[1], 10, 64)
	var pages int64
	for _, match := range vmStatPages.FindAllStringSubmatch(text, -1) {
		count, _ := strconv.ParseInt(match[2], 10, 64)
		pages += count
	}
	return pages * pageSize
}

// ParseMemInfo reads Linux /proc/meminfo's MemAvailable as bytes, or 0.
func ParseMemInfo(text string) int64 {
	match := memAvailable.FindStringSubmatch(strings.TrimSpace(text))
	if match == nil {
		return 0
	}
	kilobytes, _ := strconv.ParseInt(match[1], 10, 64)
	return kilobytes * 1024
}
