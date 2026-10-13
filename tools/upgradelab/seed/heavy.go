package seed

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/langwatch/langwatch/tools/seedgen"
)

// HeavyInput is one tier M seed against a running main at App: no haven slug, only its URL.
type HeavyInput struct {
	App, Email, Password string
	Tenancy              Tenancy // its projects' keys carry the telemetry
	Seed                 int64
	Anchor               time.Time
	Spans                int    // 0 is the size's own volume
	Size                 string // seedgen's size: its organizations make the product kinds; default medium
	TelemetryOnly        bool   // skip the product kinds: a trickle of live telemetry, not a second seed
	Workers              int    // concurrent doors; default 8: requests carry up to 500 spans, so 32 timed out and starved the grants projection
	Log                  io.Writer
	Pace                 *Pace // nil sends the telemetry in one burst, as a trickle does
}

// HeavyVolumes is the spans a heavy seed sends per tier; metric points and logs follow the spans.
// M is a tenth of seedgen's medium so one main worker drains it; L, the long tail, spreads as many over more organizations.
var HeavyVolumes = map[string]int{"M": 30_000, "L": 30_000}

// HeavySpans is the span volume of a tier; an unknown tier is seedgen's medium.
func HeavySpans(tier string) int { return cmp.Or(HeavyVolumes[tier], 300_000) }

// Pace sends telemetry in waves: after every WaveChunks requests the seed waits while Depth is above Above.
type Pace struct {
	Depth      func(ctx context.Context) (int, error)
	Above      int           // the queue depth above which the next wave waits
	WaveChunks int           // requests per wave; default 20
	Within     time.Duration // longest one wait; past it the seed stops
	Poll       time.Duration // between depth reads; default 5s
}

const (
	defaultWaveChunks = 20
	defaultPacePoll   = 5 * time.Second
)

// ErrOrganizationsRefused means a product organization could not be made, so no telemetry was sent.
var ErrOrganizationsRefused = errors.New("a product organization could not be created")

// ErrPaceExpired means the queue stayed above the pacing threshold for longer than the bound.
var ErrPaceExpired = errors.New("the queue stayed above the pacing threshold")

type paceState int

const (
	paceGo paceState = iota
	paceWait
	paceExpired
)

// paceVerdict judges one depth reading: go at or below above (or when unread, which never blocks a
// wave); expired once waited passes limit; wait otherwise.
func paceVerdict(depth int, readErr error, above int, waited, limit time.Duration) paceState {
	switch {
	case readErr != nil || depth <= above:
		return paceGo
	case waited >= limit:
		return paceExpired
	}
	return paceWait
}

// HeavyResult counts what main accepted and refused, by kind.
type HeavyResult struct {
	Sent    map[string]int
	Refused map[string]int
	Made    []string // API keys of the projects made through the product's doors: the scrubber allows them
}

// Heavy first makes the product's own organizations and one of every product and REST kind in each
// (a refused organization stops the seed before any telemetry), then sends the telemetry into the
// tenancy's projects through the OTLP door, in waves when Pace is set. One refused kind never stops
// the others; the error names each.
func Heavy(ctx context.Context, in HeavyInput) (HeavyResult, error) {
	door := &seedgen.Door{App: in.App, Email: in.Email, Password: in.Password, Keys: map[string]string{}}
	result := HeavyResult{Sent: map[string]int{}, Refused: map[string]int{}}
	var mu sync.Mutex
	count := func(kind string, reply seedgen.Reply) {
		mu.Lock()
		defer mu.Unlock()
		if reply.OK {
			result.Sent[kind]++
		} else {
			result.Refused[kind]++
		}
	}
	var live []Project
	for i := range in.Tenancy.Projects {
		if project := in.Tenancy.Projects[i]; !project.Archived {
			live = append(live, project)
			door.Keys[project.ID] = project.APIKey
		}
	}
	if len(live) == 0 {
		return result, errors.New("the tenancy holds no live project to send telemetry to")
	}
	plan, err := heavyPlan(in)
	if err != nil {
		return result, err
	}
	run := &heavyRun{door: door, plan: plan, live: live, workers: cmp.Or(in.Workers, defaultHeavyWorkers), count: count}
	run.pace, run.log = in.Pace, in.Log
	if in.TelemetryOnly {
		return result, errors.Join(run.telemetry(ctx)...)
	}
	productErrs := run.product(ctx)
	result.Made = madeKeys(door.Keys, live)
	if slices.ContainsFunc(productErrs, func(err error) bool { return errors.Is(err, ErrOrganizationsRefused) }) {
		return result, errors.Join(productErrs...)
	}
	return result, errors.Join(append(productErrs, run.telemetry(ctx)...)...)
}

// madeKeys is every door key that belongs to no tenancy project, so to a project the seed made.
func madeKeys(keys map[string]string, tenancy []Project) []string {
	seeded := map[string]bool{}
	for i := range tenancy {
		seeded[tenancy[i].ID] = true
	}
	var made []string
	for id, key := range keys {
		if !seeded[id] && key != "" {
			made = append(made, key)
		}
	}
	slices.Sort(made)
	return made
}

func heavyPlan(in HeavyInput) (*seedgen.Plan, error) {
	args := []string{"--size", cmp.Or(in.Size, "medium"), "--private", "0", "--seed", strconv.FormatInt(in.Seed, 10)}
	if in.Spans > 0 {
		args = append(args, "--spans", strconv.Itoa(in.Spans))
	}
	flags, err := seedgen.ParseFlags(args, in.Anchor)
	if err != nil {
		return nil, err
	}
	return seedgen.NewPlan(flags)
}

// telemetry deals each plan project's cells to the tenancy's live projects in order, packs their
// chunks into requests up to seedgen's bounds, and sends them from a pool of workers.
func (run *heavyRun) telemetry(ctx context.Context) []error {
	chunks := make(chan seedgen.Action, run.workers)
	pool := &chunkPool{door: run.door, count: run.count, packer: &seedgen.Packer{Now: time.Now()}}
	waves := 0
	for range run.workers {
		pool.wg.Go(func() { pool.drain(ctx, chunks) })
	}
	owner := map[string]string{}
	for step := range run.plan.Steps() {
		if step.Cell == nil || step.Cell.Private {
			continue
		}
		if _, ok := owner[step.Cell.Project]; !ok {
			owner[step.Cell.Project] = run.live[len(owner)%len(run.live)].ID
		}
		pool.deal(dealt{plan: run.plan, step: step, project: owner[step.Cell.Project]}, chunks)
		if err := run.wave(ctx, pool, &waves); err != nil {
			pool.fail(err)
			break
		}
	}
	requests := pool.packer.Flush()
	for i := range requests {
		chunks <- requests[i]
	}
	close(chunks)
	pool.wg.Wait()
	return pool.errs
}

// chunkPool sends chunks concurrently and keeps each refusal as an error.
// heavyRun is what one Heavy seed shares between its two halves.
type heavyRun struct {
	door    *seedgen.Door
	plan    *seedgen.Plan
	live    []Project
	workers int
	count   func(string, seedgen.Reply)
	pace    *Pace
	log     io.Writer
}

// wave holds the next chunk back, while the queue is above the pace threshold, once a wave of
// requests has been sent.
func (run *heavyRun) wave(ctx context.Context, pool *chunkPool, waves *int) error {
	pace := run.pace
	if pace == nil || pace.Depth == nil {
		return nil
	}
	size := cmp.Or(pace.WaveChunks, defaultWaveChunks)
	if pool.sent.Load() < int64(size*(*waves+1)) {
		return nil
	}
	*waves++
	start := time.Now()
	for {
		depth, err := pace.Depth(ctx)
		switch paceVerdict(depth, err, pace.Above, time.Since(start), pace.Within) {
		case paceGo:
			run.logf("upgradelab: telemetry wave %d sent (%d requests so far), queue depth %d (unread: %v), next wave goes\n", *waves, pool.sent.Load(), depth, err)
			return nil
		case paceWait:
		case paceExpired:
			return fmt.Errorf("%w: %d jobs above %d after %s", ErrPaceExpired, depth, pace.Above, pace.Within)
		}
		run.logf("upgradelab: telemetry wave %d sent, queue depth %d above %d, waiting %s\n", *waves, depth, pace.Above, time.Since(start).Round(time.Second))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(cmp.Or(pace.Poll, defaultPacePoll)):
		}
	}
}

func (run *heavyRun) logf(format string, args ...any) {
	if run.log != nil {
		fmt.Fprintf(run.log, format, args...)
	}
}

type chunkPool struct {
	door   *seedgen.Door
	count  func(string, seedgen.Reply)
	packer *seedgen.Packer // only deal touches it, from one goroutine
	wg     sync.WaitGroup
	sent   atomic.Int64 // requests the workers finished
	mu     sync.Mutex
	errs   []error
}

func (pool *chunkPool) fail(err error) {
	pool.mu.Lock()
	pool.errs = append(pool.errs, err)
	pool.mu.Unlock()
}

func (pool *chunkPool) drain(ctx context.Context, chunks <-chan seedgen.Action) {
	for chunk := range chunks {
		reply, err := sendRetrying(ctx, pool.door, chunk)
		if err != nil {
			pool.fail(fmt.Errorf("%s: %w", chunk.Kind, err))
		}
		pool.count(chunk.Kind, reply)
		pool.sent.Add(1)
	}
}

type dealt struct {
	plan    *seedgen.Plan
	step    seedgen.Step
	project string
}

func (pool *chunkPool) deal(cell dealt, chunks chan<- seedgen.Action) {
	for chunk, err := range cell.plan.Chunks(cell.step) {
		if err != nil {
			pool.fail(err)
			return
		}
		chunk.Project = cell.project
		closed, err := pool.packer.Add(chunk)
		if err != nil {
			pool.fail(err)
			return
		}
		for i := range closed {
			chunks <- closed[i]
		}
	}
}

// product makes one organization per plan organization through the product's own onboarding, so
// its authorization rows are main's, then one of every product and REST kind in its first project.
func (run *heavyRun) product(ctx context.Context) []error {
	var errs []error
	for index, org := range run.plan.Orgs {
		if !org.Private {
			errs = append(errs, heavyOrg(ctx, run.door, heavyOrgInput{index: index + 1, persona: org.Persona, count: run.count})...)
		}
	}
	return errs
}

type heavyOrgInput struct {
	index   int
	persona string
	count   func(string, seedgen.Reply)
}

func heavyOrg(ctx context.Context, door *seedgen.Door, in heavyOrgInput) []error {
	label := strconv.Itoa(in.index)
	name := fmt.Sprintf("Heavy %s %s", in.persona, label)
	reply, _ := sendOrg(ctx, door, seedgen.Action{Kind: seedgen.KindProductOrg, Input: marshal(map[string]string{"orgName": name, "projectName": "heavy " + label})})
	in.count(seedgen.KindProductOrg, reply)
	if !reply.OK {
		return []error{fmt.Errorf("%w: kind %s for %s refused: %s", ErrOrganizationsRefused, seedgen.KindProductOrg, name, reply.Code)}
	}
	projectID, key, err := heavyProject(ctx, door, reply.Refs["projectSlug"])
	if err != nil {
		return []error{fmt.Errorf("organization %s: %w", name, err)}
	}
	door.Keys[projectID] = key
	var errs []error
	scenarioID := ""
	actions := heavyActions(projectID, label)
	for i := range actions {
		action := actions[i]
		if action.Kind == seedgen.KindProductSuite {
			action.Input = marshal(map[string]any{"projectId": projectID, "name": "heavy suite " + label, "scenarioIds": []string{scenarioID}})
		}
		reply, _ = sendRetrying(ctx, door, action)
		in.count(action.Kind, reply)
		if action.Kind == seedgen.KindProductScenario {
			scenarioID = reply.Refs["id"]
		}
		if !reply.OK {
			errs = append(errs, fmt.Errorf("kind %s in %s: %s", action.Kind, name, reply.Code))
		}
	}
	return errs
}

func heavyProject(ctx context.Context, door *seedgen.Door, slug string) (string, string, error) {
	data, err := door.TRPC(ctx, seedgen.TRPCCall{Path: "organization.getAll", Input: map[string]any{}})
	if err != nil {
		return "", "", err
	}
	var all []organization
	if err := json.Unmarshal(data, &all); err != nil {
		return "", "", err
	}
	id := projectIn(all, slug)
	if id == "" {
		return "", "", errors.New("organization.getAll lists no project")
	}
	data, err = door.TRPC(ctx, seedgen.TRPCCall{Path: "project.getProjectAPIKey", Input: projectInput(ProductContext{ProjectID: id})})
	if err != nil {
		return "", "", err
	}
	var key struct{ APIKey string }
	return id, key.APIKey, errors.Join(json.Unmarshal(data, &key))
}

// heavyActions are every product and REST kind with a door, for one project; the suite follows its scenario.
// No retention: these orgs are on the free plan, where main refuses it (403); the S product seed covers it.
func heavyActions(projectID, label string) []seedgen.Action {
	scope := map[string]any{"scopeType": "PROJECT", "scopeId": projectID}
	rows := []struct {
		kind  string
		input any
	}{
		{seedgen.KindProductPrivacy, map[string]any{"projectId": projectID, "scope": scope, "personalOnly": false, "config": map[string]any{}}},
		{seedgen.KindProductWorkflow, map[string]any{"projectId": projectID, "commitMessage": "heavy seed", "dsl": map[string]any{
			"spec_version": "1.4", "name": "heavy workflow " + label, "icon": "🧪", "description": "heavy seed", "version": "1.0",
			"default_llm": map[string]any{"model": "openai/gpt-5"}, "template_adapter": "default", "enable_tracing": true,
			"nodes": []any{}, "edges": []any{}, "state": map[string]any{}}}},
		{seedgen.KindProductSlack, map[string]any{"projectId": projectID, "name": "heavy slack " + label, "kind": "INCOMING_WEBHOOK",
			"scopeType": "PROJECT", "scopeId": projectID, "secret": slackWebhook}},
		{seedgen.KindProductReport, map[string]any{"projectId": projectID, "name": "heavy report " + label}},
		{seedgen.KindProductScenario, map[string]any{"projectId": projectID, "name": "heavy scenario " + label, "situation": "heavy seed"}},
		{seedgen.KindProductSuite, nil},
		{seedgen.KindRESTDataset, map[string]any{"name": "heavy dataset " + label, "columnTypes": []map[string]string{{"name": "input", "type": "string"}, {"name": "expected_output", "type": "string"}}}},
		{seedgen.KindRESTPrompt, map[string]any{"handle": "heavy-prompt-" + label, "prompt": "Answer briefly.", "model": "openai/gpt-5", "messages": []any{}}},
	}
	actions := make([]seedgen.Action, len(rows))
	for i, row := range rows {
		actions[i] = seedgen.Action{Kind: row.kind, Project: projectID, Input: marshal(row.input)}
	}
	return actions
}

func marshal(value any) json.RawMessage {
	data, _ := json.Marshal(value)
	return data
}

const (
	defaultHeavyWorkers = 8
	heavyAttempts       = 5
)

const orgAttempts = 10

var orgBackoff, orgBackoffMax = 2 * time.Second, 30 * time.Second

// sendOrg resends an organization the door refused, whatever the cause: the grant projection answers
// "access change still processing" until it catches up, and the refusal does not carry that text. It
// is the only door that is idempotent enough to repeat without a retryable mark.
func sendOrg(ctx context.Context, door *seedgen.Door, action seedgen.Action) (seedgen.Reply, error) {
	return resendWith(ctx, resendInput{door: door, action: action, attempts: orgAttempts, wait: orgBackoff, max: orgBackoffMax, always: true})
}

type resendInput struct {
	door     *seedgen.Door
	action   seedgen.Action
	attempts int
	wait     time.Duration
	max      time.Duration
	always   bool // resend any refusal, not only a retryable one
}

func resendWith(ctx context.Context, in resendInput) (seedgen.Reply, error) {
	wait := in.wait
	for attempt := 1; ; attempt++ {
		reply, err := in.door.Send(ctx, in.action)
		if err != nil || reply.OK || (!reply.Retryable && !in.always) || attempt == in.attempts {
			return reply, err
		}
		select {
		case <-ctx.Done():
			return reply, ctx.Err()
		case <-time.After(wait):
		}
		wait = min(wait*2, in.max)
	}
}

// sendRetrying resends a retryable refusal (a timeout, a 5xx such as an unconfirmed grant) with doubling back-off.
func sendRetrying(ctx context.Context, door *seedgen.Door, action seedgen.Action) (seedgen.Reply, error) {
	return resendWith(ctx, resendInput{door: door, action: action, attempts: heavyAttempts, wait: 2 * time.Second, max: time.Hour})
}
