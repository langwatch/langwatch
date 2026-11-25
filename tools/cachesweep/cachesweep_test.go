package cachesweep_test

import (
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/tools/cachesweep"
)

func sha(c string) string  { return strings.Repeat(c, 40) }
func lock(c string) string { return strings.Repeat(c, 64) }

func entry(id int64, key string, day int) cachesweep.Entry {
	return cachesweep.Entry{ID: id, Key: key, CreatedAt: time.Date(2026, 10, day, 12, 0, 0, 0, time.UTC)}
}

func ids(entries []cachesweep.Entry) []int64 {
	out := []int64{}
	for _, e := range entries {
		out = append(out, e.ID)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// @scenario "Older per-commit copies on main are superseded by the newest"
func TestSupersededKeepsTheNewestCopy(t *testing.T) {
	entries := []cachesweep.Entry{
		entry(1, "Linux-nx-build-"+sha("1"), 20),
		entry(3, "Linux-nx-build-"+sha("3"), 27),
		entry(2, "Linux-nx-build-"+sha("2"), 24),
	}
	assert.Equal(t, []int64{1, 2}, ids(cachesweep.Superseded(entries)))
}

// @scenario "Each lockfile hash keeps its own newest copy"
func TestSupersededKeepsOneCopyPerLockfileHash(t *testing.T) {
	entries := []cachesweep.Entry{
		entry(1, "Linux-pkg-dist-"+lock("a")+"-"+sha("1"), 20),
		entry(2, "Linux-pkg-dist-"+lock("a")+"-"+sha("2"), 22),
		entry(3, "Linux-pkg-dist-"+lock("b")+"-"+sha("3"), 26),
	}
	assert.Equal(t, []int64{1}, ids(cachesweep.Superseded(entries)))
}

// @scenario "Caches with different names before the commit are kept apart"
func TestSupersededKeepsDifferentNamesApart(t *testing.T) {
	entries := []cachesweep.Entry{
		entry(1, "Linux-nx-suites-1-"+sha("1"), 20),
		entry(2, "Linux-nx-suites-2-"+sha("1"), 20),
	}
	assert.Empty(t, cachesweep.Superseded(entries))
}

// @scenario "A cache saved under another version keeps its own newest copy"
func TestSupersededKeepsVersionsApart(t *testing.T) {
	older := entry(1, "Linux-nx-build-"+sha("1"), 20)
	older.Version = "zstd"
	newer := entry(2, "Linux-nx-build-"+sha("2"), 26)
	newer.Version = "gzip"
	assert.Empty(t, cachesweep.Superseded([]cachesweep.Entry{older, newer}))
}

// @scenario "Caches not keyed by a commit are left alone"
func TestSupersededLeavesOtherCachesAlone(t *testing.T) {
	entries := []cachesweep.Entry{
		entry(1, "buildkit-blob-1-sha256:"+lock("a"), 20),
		entry(2, "buildkit-blob-1-sha256:"+lock("b"), 21),
		entry(3, "pnpm-store-Linux-X64-"+lock("c"), 20),
		entry(4, "pnpm-store-Linux-X64-"+lock("d"), 22),
		entry(5, "Linux-playwright-1.63.0", 20),
	}
	assert.Empty(t, cachesweep.Superseded(entries))
}
