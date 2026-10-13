package apidiff

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestHavenWaitSeeded(t *testing.T) {
	t.Run("a modular stack whose key answers 401 at first is waited on, then its worker reloaded", func(t *testing.T) {
		fake := &fakeHaven{}
		state := havenState(fake, time.Minute)
		answers := []int{http.StatusBadGateway, http.StatusUnauthorized, http.StatusOK}
		state.seedProbe = func(context.Context, string) int {
			status := answers[0]
			answers = answers[1:]
			return status
		}
		instance := Instance{Name: "branch", Dir: "/w/branch", URL: "https://app.x.langwatch.localhost", Profile: bootProfile{name: profileModular}}
		if err := state.havenWaitSeeded(context.Background(), &instance); err != nil {
			t.Fatalf("havenWaitSeeded: %v", err)
		}
		if len(answers) != 0 {
			t.Errorf("stopped probing with %d answers left", len(answers))
		}
		if !reloadedWorker(fake) {
			t.Errorf("worker not reloaded: %+v", fake.commands)
		}
	})

	t.Run("a stack seeded before it served is neither waited on nor reloaded", func(t *testing.T) {
		fake := &fakeHaven{}
		state := havenState(fake, time.Minute)
		state.seedProbe = func(context.Context, string) int { return http.StatusOK }
		instance := Instance{Name: "main", Dir: "/w/main", Profile: bootProfile{name: profileModular}}
		if err := state.havenWaitSeeded(context.Background(), &instance); err != nil {
			t.Fatalf("havenWaitSeeded: %v", err)
		}
		if reloadedWorker(fake) {
			t.Error("reloaded a worker that saw its seed")
		}
	})

	t.Run("a key that never authenticates fails the boot", func(t *testing.T) {
		state := havenState(&fakeHaven{}, 10*time.Millisecond)
		state.seedProbe = func(context.Context, string) int { return http.StatusUnauthorized }
		instance := Instance{Name: "branch", Profile: bootProfile{name: profileModular}}
		err := state.havenWaitSeeded(context.Background(), &instance)
		if err == nil || !strings.Contains(err.Error(), "never authenticated") {
			t.Fatalf("want a never-authenticated error, got %v", err)
		}
	})
}

func reloadedWorker(fake *fakeHaven) bool {
	for _, spec := range fake.commands {
		if len(spec.args) > 1 && spec.args[0] == "reload" && spec.args[1] == "worker" {
			return true
		}
	}
	return false
}

func TestRedisSlotsIn(t *testing.T) {
	t.Run("each stack's Redis database is read, a stack without one is skipped", func(t *testing.T) {
		slots := redisSlotsIn([]byte(`{"stacks":[{"slug":"apidiff-x-branch","redisDb":4,"redisPort":6379},{"slug":"other","redisDb":0,"redisPort":6379},{"slug":"bare"}]}`))
		if len(slots) != 2 || slots[0] != (havenRedisSlot{slug: "apidiff-x-branch", db: 4, port: 6379}) || slots[1].db != 0 {
			t.Errorf("slots = %+v", slots)
		}
	})
}
