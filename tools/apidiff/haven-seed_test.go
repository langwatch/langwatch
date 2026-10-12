package apidiff

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
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

func TestEnableMonolithWorkers(t *testing.T) {
	t.Run("a monolith worktree's app .env gains the in-process workers line once", func(t *testing.T) {
		dir := t.TempDir()
		appDir := filepath.Join(dir, "platform", "app")
		if err := os.MkdirAll(appDir, 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte("A=1"), 0o600); err != nil {
			t.Fatal(err)
		}
		instance := Instance{Dir: dir, Profile: bootProfile{name: profileMonolith}}
		for range 2 {
			if err := enableMonolithWorkers(instance); err != nil {
				t.Fatal(err)
			}
		}
		written, err := os.ReadFile(filepath.Join(appDir, ".env")) //nolint:gosec // test temp dir
		if err != nil {
			t.Fatal(err)
		}
		if got := strings.Count(string(written), monolithWorkersInProcess); got != 1 {
			t.Errorf("want one %s line, got %d in %q", monolithWorkersInProcess, got, written)
		}
	})

	t.Run("a modular worktree is left alone", func(t *testing.T) {
		dir := t.TempDir()
		if err := enableMonolithWorkers(Instance{Dir: dir, Profile: bootProfile{name: profileModular}}); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(dir, "platform")); !os.IsNotExist(err) {
			t.Errorf("modular worktree touched: %v", err)
		}
	})
}

func TestRedisSlotsIn(t *testing.T) {
	t.Run("each stack's Redis database is read, a stack without one is skipped", func(t *testing.T) {
		slots := redisSlotsIn([]byte(`{"stacks":[{"slug":"apidiff-x-branch","redisDb":4,"redisPort":6379},{"slug":"other","redisDb":0,"redisPort":6379},{"slug":"bare"}]}`))
		if len(slots) != 2 || slots[0] != (havenRedisSlot{slug: "apidiff-x-branch", db: 4, port: 6379}) || slots[1].db != 0 {
			t.Errorf("slots = %+v", slots)
		}
	})
}
