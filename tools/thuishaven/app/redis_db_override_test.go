package app

import (
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestAllocateRedisDB(t *testing.T) {
	t.Run("given LANGWATCH_HAVEN_REDIS_DB pins an index", func(t *testing.T) {
		t.Run("when the stack is already registered elsewhere, the pin still wins", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{
				{Slug: "mine", RedisDB: 0},
				{Slug: "neighbor", RedisDB: 6},
			}}
			o := &Orchestrator{cfg: Config{RedisDBOverride: 6}, store: store, log: zap.NewNop()}
			db, exclusive := o.allocateRedisDB("mine")
			if db != 6 || !exclusive {
				t.Fatalf("allocateRedisDB = (%d, %v), want the pinned (6, true)", db, exclusive)
			}
		})
	})

	t.Run("given no pin", func(t *testing.T) {
		t.Run("when the stack is registered, its recorded database is reused", func(t *testing.T) {
			store := &fakeStore{stacks: []domain.Stack{{Slug: "mine", RedisDB: 3}}}
			o := &Orchestrator{cfg: Config{RedisDBOverride: -1}, store: store, log: zap.NewNop()}
			db, exclusive := o.allocateRedisDB("mine")
			if db != 3 || !exclusive {
				t.Fatalf("allocateRedisDB = (%d, %v), want the registered (3, true)", db, exclusive)
			}
		})
	})
}
