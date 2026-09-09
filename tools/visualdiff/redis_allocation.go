package visualdiff

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
)

// redisDBCount is the number of logical databases a stock Redis server
// serves (0-15) - matches tools/thuishaven/domain.RedisDBCount.
const redisDBCount = 16

// DefaultRedisURL is used when REDIS_URL is not set in the environment  - 
// the same default a bare local Redis listens on.
const DefaultRedisURL = "redis://localhost:6379"

// RedisAllocation is the two logical databases one run's base and candidate
// stacks land on.
type RedisAllocation struct {
	Base      int
	Candidate int
}

// RegisteredRedisDBs lists the databases haven's registry already claims for
// a running stack. visualdiff shares the developer's Postgres and
// ClickHouse on purpose (both sides must render the same rows) but must
// never also share a Redis logical database with a registered stack: two
// stacks on the same index share a job queue, and because every stack seeds
// the same fixed local identity the tenant ids match, so a job projects into
// the wrong stack silently (see tools/thuishaven/domain/slug.go,
// AllocateRedisDB). Returned as a function so a test can substitute a fixed
// listing without invoking the haven binary.
type RegisteredRedisDBs func() (map[int]bool, error)

// RedisDBSize reports how many keys sit in one logical database on the
// target Redis server, so the allocator can also avoid a database that is
// not registered but has residue in it anyway (a stack haven never heard of,
// or one it has forgotten).
type RedisDBSize func(index int) (int64, error)

// AllocateRedisDBs picks two distinct logical databases for a run's base and
// candidate stacks: never 0 (a developer's own stack lives there - see
// tools/thuishaven/domain/slug.go's own comment on the same reservation),
// never one the registry lists as a running stack's, and never one whose
// DBSIZE is non-zero on the server. The two lowest free indices win, checked
// in order, so a run on a quiet machine is reproducible. registered may be
// nil (haven not on PATH: the registry step is skipped and only the DBSIZE
// probe applies); size must not be nil.
func AllocateRedisDBs(registered RegisteredRedisDBs, size RedisDBSize) (RedisAllocation, error) {
	if size == nil {
		return RedisAllocation{}, errors.New("visualdiff: redis DBSIZE probe is required")
	}
	taken, err := excludedRedisDBs(registered)
	if err != nil {
		return RedisAllocation{}, err
	}
	free, err := freeRedisDBs(taken, size)
	if err != nil {
		return RedisAllocation{}, err
	}
	if len(free) < 2 {
		return RedisAllocation{}, fmt.Errorf(
			"visualdiff: no two free redis logical databases (checked 1-%d, %d free, %d excluded by the registry)",
			redisDBCount-1, len(free), len(taken)-1)
	}
	return RedisAllocation{Base: free[0], Candidate: free[1]}, nil
}

// excludedRedisDBs is every database this run must never consider: 0 always
// (a developer's own stack), plus whatever the registry lists as a running
// stack's. registered may be nil, meaning the registry step was skipped.
func excludedRedisDBs(registered RegisteredRedisDBs) (map[int]bool, error) {
	taken := map[int]bool{0: true}
	if registered == nil {
		return taken, nil
	}
	listed, err := registered()
	if err != nil {
		return nil, fmt.Errorf("redis registry: %w", err)
	}
	for db := range listed {
		taken[db] = true
	}
	return taken, nil
}

// freeRedisDBs probes every database not already excluded, lowest index
// first, and returns the first two whose DBSIZE comes back empty.
func freeRedisDBs(taken map[int]bool, size RedisDBSize) ([]int, error) {
	free := make([]int, 0, 2)
	for index := 1; index < redisDBCount; index++ {
		if taken[index] {
			continue
		}
		count, err := size(index)
		if err != nil {
			return nil, fmt.Errorf("redis DBSIZE %d: %w", index, err)
		}
		if count != 0 {
			continue
		}
		free = append(free, index)
		if len(free) == 2 {
			break
		}
	}
	return free, nil
}

// havenOnPath reports whether the haven binary is reachable, so a checkout
// with no local haven install can still run visualdiff - the registry step
// is simply skipped, and only the DBSIZE probe guards the allocation.
func havenOnPath() bool {
	_, err := exec.LookPath("haven")
	return err == nil
}

// havenStatusReport is the slice of `haven status --agent --json` this
// package reads: one redisDb per registered stack.
type havenStatusReport struct {
	Stacks []struct {
		RedisDB int `json:"redisDb"`
	} `json:"stacks"`
}

// HavenRegisteredRedisDBs lists the redisDb each of haven's registered
// stacks holds, by shelling out to `haven status --agent --json`
// (tools/thuishaven/app/report.go's Status, embedding domain.Stack's
// "redisDb" field). When haven is not on PATH the registry step is skipped:
// it returns (nil, nil), meaning there is nothing to exclude on its account,
// and only the DBSIZE probe still guards the choice.
func HavenRegisteredRedisDBs(ctx context.Context) (map[int]bool, error) {
	if !havenOnPath() {
		return nil, nil
	}
	out, err := exec.CommandContext(ctx, "haven", "status", "--agent", "--json").Output()
	if err != nil {
		return nil, fmt.Errorf("haven status --agent --json: %w", err)
	}
	var report havenStatusReport
	if err := json.Unmarshal(out, &report); err != nil {
		return nil, fmt.Errorf("haven status --agent --json: %w", err)
	}
	dbs := make(map[int]bool, len(report.Stacks))
	for _, stack := range report.Stacks {
		dbs[stack.RedisDB] = true
	}
	return dbs, nil
}

// ResolveRedisAllocation is the real allocation path a run uses: haven's
// registry (skipped when haven is not on PATH) plus a live DBSIZE probe
// against REDIS_URL (DefaultRedisURL when unset - read from the process
// environment only, the same inherited environment every stack's own
// process already draws REDIS_URL from; nothing here reads or logs a
// dotenv file).
func ResolveRedisAllocation(ctx context.Context) (RedisAllocation, error) {
	registered := func() (map[int]bool, error) { return HavenRegisteredRedisDBs(ctx) }
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = DefaultRedisURL
	}
	return AllocateRedisDBs(registered, NewRedisDBSizeProbe(ctx, redisURL))
}
