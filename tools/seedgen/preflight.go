package seedgen

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"syscall"
)

// ClickHouseFloors is the smallest ClickHouse memory cap a tier runs under (design §5.5).
var ClickHouseFloors = map[string]int64{"large": 6 << 30}

// PreflightError is exit 2: the plan cannot fit, nothing was written (design §5.5).
type PreflightError struct{ Shortfall, Raise string }

func (e *PreflightError) Error() string { return e.Shortfall + "; " + e.Raise }

// Capacity is what the stack has room for: free disk, and ClickHouse's memory cap (0: unknown or
// uncapped, not checked).
type Capacity struct{ FreeDisk, ClickHouseCap int64 }

// Preflight refuses a plan whose estimated bytes exceed the free disk, or whose tier needs more
// ClickHouse memory than the cap.
func Preflight(estimate Estimate, size string, capacity Capacity) error {
	freeDisk, clickHouseCap := capacity.FreeDisk, capacity.ClickHouseCap
	var need int64
	for _, store := range estimate.Stores {
		need += store.Bytes
	}
	if need > freeDisk {
		return &PreflightError{
			Shortfall: fmt.Sprintf("the plan needs about %d MB on disk and %d MB is free", need>>20, freeDisk>>20),
			Raise:     "free disk space, or seed less with --size or --spans",
		}
	}
	if floor := ClickHouseFloors[size]; clickHouseCap > 0 && clickHouseCap < floor {
		return &PreflightError{
			Shortfall: fmt.Sprintf("the %s tier needs ClickHouse capped at %d MB or more; it is %d MB", size, floor>>20, clickHouseCap>>20),
			Raise:     fmt.Sprintf("raise it with `haven limits set clickhouse-memory-mb %d`, then `haven up`", floor>>20),
		}
	}
	return nil
}

// FreeDisk is the space available to an unprivileged writer on the volume holding path.
func FreeDisk(path string) (int64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return int64(stat.Bavail) * int64(stat.Bsize), nil
}

// ClickHouseCap reads max_server_memory_usage from CLICKHOUSE_URL; 0 when it cannot be read.
func ClickHouseCap(ctx context.Context) int64 {
	raw := os.Getenv("CLICKHOUSE_URL")
	if raw == "" {
		return 0
	}
	fields, err := clickHouseRow(ctx, raw,
		"SELECT value FROM system.server_settings WHERE name = 'max_server_memory_usage' FORMAT TSV")
	if err != nil || len(fields) == 0 {
		return 0
	}
	value, _ := strconv.ParseInt(fields[0], 10, 64)
	return value
}
