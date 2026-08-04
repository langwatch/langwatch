package config

import (
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
)

// DetectCPU returns the number of CPU cores available.
// Priority: cgroups v2 → cgroups v1 → runtime.NumCPU.
func DetectCPU() (int, error) {
	// cgroups v2
	if data, err := os.ReadFile("/sys/fs/cgroup/cpu.max"); err == nil {
		if cores, ok := parseCPUMaxV2(string(data)); ok {
			return cores, nil
		}
	}

	// cgroups v1
	if quotaData, err := os.ReadFile("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"); err == nil {
		if periodData, err := os.ReadFile("/sys/fs/cgroup/cpu/cpu.cfs_period_us"); err == nil {
			if cores, ok := parseCPUQuotaV1(string(quotaData), string(periodData)); ok {
				return cores, nil
			}
		}
	}

	// Fallback
	n := runtime.NumCPU()
	if n < 1 {
		return 1, nil
	}
	return n, nil
}

// DetectRAM returns available RAM in bytes.
// Priority: cgroups v2 → cgroups v1 → /proc/meminfo.
func DetectRAM() (int64, error) {
	// cgroups v2
	if data, err := os.ReadFile("/sys/fs/cgroup/memory.max"); err == nil {
		if v, ok := parseMemoryMax(string(data)); ok {
			return v, nil
		}
	}

	// cgroups v1
	if data, err := os.ReadFile("/sys/fs/cgroup/memory/memory.limit_in_bytes"); err == nil {
		if v, ok := parseMemoryMax(string(data)); ok {
			return v, nil
		}
	}

	// Fallback: /proc/meminfo
	if data, err := os.ReadFile("/proc/meminfo"); err == nil {
		if v, ok := parseMeminfo(string(data)); ok {
			return v, nil
		}
	}

	return 0, fmt.Errorf("could not detect RAM from cgroups or /proc/meminfo")
}

// noLimitSentinel is the cgroups v1 value for "no limit".
const noLimitSentinel int64 = 9223372036854771712

// parseCPUMaxV2 parses cgroups v2 cpu.max content ("quota period").
// Returns (cores, true) on success.
func parseCPUMaxV2(data string) (int, bool) {
	parts := strings.Fields(strings.TrimSpace(data))
	if len(parts) != 2 || parts[0] == "max" {
		return 0, false
	}
	quota, err1 := strconv.ParseInt(parts[0], 10, 64)
	period, err2 := strconv.ParseInt(parts[1], 10, 64)
	if err1 != nil || err2 != nil || period <= 0 {
		return 0, false
	}
	cores := int((quota + period - 1) / period) // round up
	if cores <= 0 {
		return 0, false
	}
	return cores, true
}

// parseCPUQuotaV1 parses cgroups v1 quota and period files.
func parseCPUQuotaV1(quotaData, periodData string) (int, bool) {
	quota, err1 := strconv.ParseInt(strings.TrimSpace(quotaData), 10, 64)
	period, err2 := strconv.ParseInt(strings.TrimSpace(periodData), 10, 64)
	if err1 != nil || err2 != nil || quota <= 0 || period <= 0 {
		return 0, false
	}
	cores := int((quota + period - 1) / period) // round up
	if cores <= 0 {
		return 0, false
	}
	return cores, true
}

// parseMemoryMax parses a cgroups memory limit value.
// Returns (bytes, true) on success. Returns false for "max", the no-limit sentinel, or invalid data.
func parseMemoryMax(data string) (int64, bool) {
	s := strings.TrimSpace(data)
	if s == "max" {
		return 0, false
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v <= 0 || v >= noLimitSentinel {
		return 0, false
	}
	return v, true
}

// parseMeminfo parses /proc/meminfo content and returns total RAM in bytes.
func parseMeminfo(data string) (int64, bool) {
	for _, line := range strings.Split(data, "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				kb, err := strconv.ParseInt(fields[1], 10, 64)
				if err == nil && kb > 0 && kb <= (1<<50)/1024 {
					return kb * 1024, true
				}
			}
		}
	}
	return 0, false
}
