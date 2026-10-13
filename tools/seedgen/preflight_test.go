package seedgen

import (
	"errors"
	"strings"
	"testing"
)

// @scenario "The seed refuses a plan that cannot fit"
func TestPreflightRefusesDiskAndClickHouseShortfalls(t *testing.T) {
	estimate := Estimate{Stores: map[string]StoreEstimate{"clickhouse": {Bytes: 3 << 30}, "postgres": {Bytes: 1 << 20}}}
	var refusal *PreflightError
	err := Preflight(estimate, "medium", Capacity{FreeDisk: 2 << 30})
	if !errors.As(err, &refusal) || !strings.Contains(refusal.Shortfall, "2048 MB is free") {
		t.Fatalf("want a disk shortfall, got %v", err)
	}
	err = Preflight(estimate, "large", Capacity{FreeDisk: 100 << 30, ClickHouseCap: 3 << 30})
	if !errors.As(err, &refusal) || !strings.Contains(refusal.Raise, "haven machine limits set clickhouse-memory-mb 6144") {
		t.Fatalf("want the ClickHouse floor and the haven limit that raises it, got %v", err)
	}
	if err := Preflight(estimate, "large", Capacity{FreeDisk: 100 << 30, ClickHouseCap: 8 << 30}); err != nil {
		t.Fatalf("a plan that fits is refused: %v", err)
	}
}
