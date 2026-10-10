package seed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/seedgen"
)

// HeavyInput is one tier M seed against a running main at App: no haven slug, only its URL.
type HeavyInput struct {
	App, Email, Password string
	Tenancy              Tenancy // its projects' keys carry the telemetry
	Seed                 int64
	Anchor               time.Time
	Spans                int // 0 is seedgen's medium: about 300k
	Workers              int // concurrent doors; default 32 (8 left main's api idle, waiting on round trips)
	Log                  io.Writer
}

// HeavyResult counts what main accepted and refused, by kind.
type HeavyResult struct {
	Sent    map[string]int
	Refused map[string]int
}

// Heavy sends seedgen's medium telemetry into the tenancy's projects through the OTLP door, then makes
// the product's own organizations and one of every product and REST kind in each. One refused kind
// never stops the others; the error names each.
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
	run := &heavyRun{door: door, plan: plan, live: live, workers: max(in.Workers, 32), count: count}
	return result, errors.Join(append(run.telemetry(ctx), run.product(ctx)...)...)
}

func heavyPlan(in HeavyInput) (*seedgen.Plan, error) {
	args := []string{"--size", "medium", "--private", "0", "--seed", strconv.FormatInt(in.Seed, 10)}
	if in.Spans > 0 {
		args = append(args, "--spans", strconv.Itoa(in.Spans))
	}
	flags, err := seedgen.ParseFlags(args, in.Anchor)
	if err != nil {
		return nil, err
	}
	return seedgen.NewPlan(flags)
}

// telemetry deals each plan project's cells to the tenancy's live projects in order, and sends the
// chunks from a pool of workers.
func (run *heavyRun) telemetry(ctx context.Context) []error {
	chunks := make(chan seedgen.Action, run.workers)
	pool := &chunkPool{door: run.door, count: run.count}
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
}

type chunkPool struct {
	door  *seedgen.Door
	count func(string, seedgen.Reply)
	wg    sync.WaitGroup
	mu    sync.Mutex
	errs  []error
}

func (pool *chunkPool) fail(err error) {
	pool.mu.Lock()
	pool.errs = append(pool.errs, err)
	pool.mu.Unlock()
}

func (pool *chunkPool) drain(ctx context.Context, chunks <-chan seedgen.Action) {
	for chunk := range chunks {
		reply, err := pool.door.Send(ctx, chunk)
		if err != nil {
			pool.fail(fmt.Errorf("%s: %w", chunk.Kind, err))
		}
		pool.count(chunk.Kind, reply)
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
		chunks <- chunk
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
	reply, _ := door.Send(ctx, seedgen.Action{Kind: seedgen.KindProductOrg, Input: marshal(map[string]string{"orgName": name, "projectName": "heavy " + label})})
	in.count(seedgen.KindProductOrg, reply)
	if !reply.OK {
		return []error{fmt.Errorf("kind %s for %s refused: %s", seedgen.KindProductOrg, name, reply.Code)}
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
		reply, _ = door.Send(ctx, action)
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
