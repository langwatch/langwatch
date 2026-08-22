package app

import (
	"strconv"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func pinnedDB(db int) *int { return &db }

func TestAllocateRedisDB(t *testing.T) {
	t.Run("given LANGWATCH_HAVEN_REDIS_DB pins an index", func(t *testing.T) {
		t.Run("when no managed stack holds it, the pin wins over the registered value", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{
				{Slug: "mine", RedisDB: 0},
				{Slug: "neighbor", RedisDB: 6},
			}}
			o := &Orchestrator{cfg: Config{RedisDBOverride: pinnedDB(5)}, store: store, log: zap.NewNop()}
			db, exclusive := o.allocateRedisDB("mine")
			if db != 5 || !exclusive {
				t.Fatalf("allocateRedisDB = (%d, %v), want the pinned (5, true)", db, exclusive)
			}
		})

		t.Run("when another managed stack already holds it, a free database is used instead", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{
				{Slug: "mine", RedisDB: 0},
				{Slug: "neighbor", RedisDB: 6},
			}}
			o := &Orchestrator{cfg: Config{RedisDBOverride: pinnedDB(6)}, store: store, log: zap.NewNop()}
			db, exclusive := o.allocateRedisDB("mine")
			if db == 6 {
				t.Fatalf("allocateRedisDB = %d, which the neighbor already holds", db)
			}
			if !exclusive {
				t.Fatalf("allocateRedisDB reported a shared database (%d)", db)
			}
		})
	})

	t.Run("given no pin", func(t *testing.T) {
		t.Run("when the stack is registered, its recorded database is reused", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{{Slug: "mine", RedisDB: 3}}}
			o := &Orchestrator{cfg: Config{}, store: store, log: zap.NewNop()}
			db, exclusive := o.allocateRedisDB("mine")
			if db != 3 || !exclusive {
				t.Fatalf("allocateRedisDB = (%d, %v), want the registered (3, true)", db, exclusive)
			}
		})

		t.Run("when the registered database was taken by another stack, a free one is used", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{
				{Slug: "mine", RedisDB: 3},
				{Slug: "neighbor", RedisDB: 3},
			}}
			o := &Orchestrator{cfg: Config{}, store: store, log: zap.NewNop()}
			db, exclusive := o.allocateRedisDB("mine")
			if db == 3 || !exclusive {
				t.Fatalf("allocateRedisDB = (%d, %v), want a free database", db, exclusive)
			}
		})
	})
}

func TestRedisDBOverrideParsing(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
		want  int
	}{
		{"unset", "", -1},
		{"non-numeric", "seven", -1},
		{"negative", "-1", -1},
		{"at the count, one past the last index", strconv.Itoa(domain.RedisDBCount), -1},
		{"the last valid index", strconv.Itoa(domain.RedisDBCount - 1), domain.RedisDBCount - 1},
		{"zero", "0", 0},
		{"a valid index", "5", 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := RedisDBOverrideFromEnv(tc.value)
			if tc.want < 0 {
				if got != nil {
					t.Fatalf("RedisDBOverrideFromEnv(%q) = %d, want no pin", tc.value, *got)
				}
				return
			}
			if got == nil || *got != tc.want {
				t.Fatalf("RedisDBOverrideFromEnv(%q) = %v, want %d", tc.value, got, tc.want)
			}
		})
	}
}
