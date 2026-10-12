package apidiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// A modular stack's keeper runs the identity seed only once its api answers
// (tools/thuishaven/app/keeper.go, seedWhenReady), so "backend listening" came
// before the seeded admin and project key existed: on 2026-10-12 the branch
// side answered 401 to every fixture and sign-in while main, seeded before it
// boots, answered 200. The run now waits for the seeded key before probing.

// seededKeyProbePath is a project-key read both layouts serve with no side
// effect: 401 until the identity seed lands, 200 after.
const seededKeyProbePath = "/api/prompts"

// havenNoAutoSeed keeps haven's tiny-tier auto-seed off both stacks. main's
// monolith never gets it, so on the branch alone its organizations and users
// would surface as list differences, written while the probes run.
const havenNoAutoSeed = "HAVEN_AUTO_SEED=0"

// monolithWorkersInProcess is what the monolith's own `dev` script sets
// before `dev:app`; haven's monolith lane runs `dev:app` without it, so main's
// app started no workers and never projected a trace.
const monolithWorkersInProcess = "WORKERS_IN_PROCESS=1"

// projectKeyStatus is the status the seeded project key answers on baseURL; 0
// when the stack did not answer.
func projectKeyStatus(ctx context.Context, baseURL string) int {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+seededKeyProbePath, nil)
	if err != nil {
		return 0
	}
	request.Header.Set("X-Auth-Token", DefaultProjectKey)
	response, err := (&http.Client{Timeout: 15 * time.Second}).Do(request)
	if err != nil {
		return 0
	}
	defer response.Body.Close()
	return response.StatusCode
}

// seedLanded reads the probe's status: no answer, 401 and a 5xx (the route
// proxy answers 502 until the lane is routed) all mean not yet.
func seedLanded(status int) bool {
	return status != 0 && status != http.StatusUnauthorized && status < http.StatusInternalServerError
}

// havenWaitSeeded waits, within the boot timeout, for the instance's seeded
// project key to authenticate. A modular stack seeds after its worker booted,
// so its worker is reloaded once the seed lands: the boot-time LangWatchQL
// key-map fill ran before the seeded project existed (haven's own auto-seed
// reloads it for the same reason, reloadAfterFirstSeed). No probe, no wait.
func (state *bootState) havenWaitSeeded(ctx context.Context, instance *Instance) error {
	if state.seedProbe == nil {
		return nil
	}
	plan := state.havenPlanFor(*instance)
	state.recordHavenRedis(ctx, plan)
	deadline := time.Now().Add(state.bootTimeout())
	started := time.Now()
	status := state.seedProbe(ctx, instance.URL)
	waited := !seedLanded(status)
	for !seedLanded(status) {
		if time.Now().After(deadline) {
			return fmt.Errorf("haven %s: the seeded project key never authenticated on %q (GET %s last answered %d after %s)",
				instance.Name, plan.slug, seededKeyProbePath, status, time.Since(started).Round(time.Second))
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollDelay(deadline)):
		}
		status = state.seedProbe(ctx, instance.URL)
	}
	state.logf("haven %s: seeded project key answers %d (waited %s)", instance.Name, status, time.Since(started).Round(time.Second))
	if !waited || instance.Profile.name == profileMonolith {
		return nil
	}
	state.logf("haven %s: reloading the worker of %q so it fills the seeded project's LangWatchQL key", instance.Name, plan.slug)
	spec := commandSpec{name: havenCommand, args: []string{"reload", "worker", "--agent"}, dir: plan.dir, env: havenEnv(state.environ(), plan.slug)}
	if err := state.run(ctx, spec, state.stderr); err != nil {
		state.logf("haven %s: worker reload failed (continuing): %v", instance.Name, err)
	}
	return nil
}

// enableMonolithWorkers appends WORKERS_IN_PROCESS=1 to a monolith worktree's
// platform/app/.env, which its env-load reads and haven's own .env check
// (the workspace root's) does not. Other layouts are left alone.
func enableMonolithWorkers(instance Instance) error {
	if instance.Profile.name != profileMonolith {
		return nil
	}
	path := filepath.Join(instance.Dir, "platform", "app", ".env")
	existing, err := os.ReadFile(path) //nolint:gosec // the run's own worktree
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if strings.Contains(string(existing), "\n"+monolithWorkersInProcess+"\n") {
		return nil
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec // the run's own worktree
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = file.WriteString("\n" + monolithWorkersInProcess + "\n")
	return err
}

// havenRedisSlot is the Redis logical database haven gave one stack.
type havenRedisSlot struct {
	slug string
	db   int
	port int
}

// redisSlotsIn reads each stack's Redis database out of a `haven status
// --json stacks` report; havenrun's decoded status does not carry it.
func redisSlotsIn(output []byte) []havenRedisSlot {
	var report struct {
		Stacks []struct {
			Slug      string `json:"slug"`
			RedisDB   *int   `json:"redisDb"`
			RedisPort int    `json:"redisPort"`
		} `json:"stacks"`
	}
	if json.Unmarshal(output, &report) != nil {
		return nil
	}
	slots := make([]havenRedisSlot, 0, len(report.Stacks))
	for _, stack := range report.Stacks {
		if stack.RedisDB != nil && stack.RedisPort != 0 {
			slots = append(slots, havenRedisSlot{slug: stack.Slug, db: *stack.RedisDB, port: stack.RedisPort})
		}
	}
	return slots
}

// havenRedisSlots asks haven which Redis database each live stack holds.
func (state *bootState) havenRedisSlots(ctx context.Context, dir, slug string) []havenRedisSlot {
	var out bytes.Buffer
	spec := commandSpec{name: havenCommand, args: havenStatusArgs(), dir: dir, env: havenEnv(state.environ(), slug)}
	if err := state.run(ctx, spec, &out); err != nil {
		return nil
	}
	return redisSlotsIn(out.Bytes())
}

// recordHavenRedis remembers the Redis database the run's stack holds, so the
// teardown can empty it (flushHavenRedis).
func (state *bootState) recordHavenRedis(ctx context.Context, plan havenPlan) {
	for _, slot := range state.havenRedisSlots(ctx, plan.dir, plan.slug) {
		if slot.slug == plan.slug {
			state.havenRedis = append(state.havenRedis, slot)
		}
	}
}

// flushHavenRedis empties each Redis database the run's destroyed stacks held
// and no live stack holds now. `haven down --destroy` left them full on
// 2026-10-12: the next run's stacks got the same two indices, and the earlier
// run's span dedup keys dropped the fixed fixture trace as a duplicate.
func (state *bootState) flushHavenRedis(ctx context.Context) {
	if len(state.havenRedis) == 0 {
		return
	}
	held := map[int]string{}
	for _, slot := range state.havenRedisSlots(ctx, state.workRoot, state.havenRedis[0].slug) {
		held[slot.db] = slot.slug
	}
	for _, slot := range state.havenRedis {
		if holder, taken := held[slot.db]; taken {
			state.logf("teardown: redis db %d of %s left alone: %s holds it now", slot.db, slot.slug, holder)
			continue
		}
		address := fmt.Sprintf("redis://127.0.0.1:%d", slot.port)
		if err := redisFlushDB(ctx, address, slot.db); err != nil {
			state.logf("teardown: flush redis db %d of %s: %v", slot.db, slot.slug, err)
			continue
		}
		state.logf("teardown: flushed redis db %d of %s", slot.db, slot.slug)
	}
}
