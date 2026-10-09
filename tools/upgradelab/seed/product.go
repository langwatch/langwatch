package seed

import (
	"bytes"
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"time"
)

const (
	slackWebhook = "https://hooks.slack.com/services/T0000000/B0000000/rehearsalseed"
	answerTail   = 600
)

var sessionCookie = regexp.MustCompile(`(?:__Secure-)?better-auth\.session_token=[^;]+`)

// ProductInput is the old app's URL, the seed account that signs in and the label each seeded name carries.
type ProductInput struct {
	AppURL, Email, Password, Label string
	Client                         *http.Client
}

// ProductContext is what the seed's own setup learned from the old app's answers.
type ProductContext struct {
	OrganizationID, ProjectID, TraceID, Label, APIKey string
}

// productDoor is one kind's tRPC create input, its read-back query and the marker the answer must hold.
type productDoor struct {
	create func(ProductContext) any
	read   string
	input  func(ProductContext) any
	marker func(ProductContext) string
}

func projectInput(ctx ProductContext) any     { return map[string]any{"projectId": ctx.ProjectID} }
func projectMarker(ctx ProductContext) string { return ctx.ProjectID }
func named(prefix string) func(ProductContext) string {
	return func(ctx ProductContext) string { return prefix + " " + ctx.Label }
}
func projectScope(ctx ProductContext) map[string]any {
	return map[string]any{"scopeType": "PROJECT", "scopeId": ctx.ProjectID}
}

// productDoors ports dev/scripts/upgrade-rehearsal/seed/product.mjs, keyed by ProductKinds' Kind.
var productDoors = map[string]productDoor{
	"privacy": {read: "dataPrivacy.getSnapshot", input: projectInput, marker: projectMarker, create: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "scope": projectScope(ctx), "personalOnly": false, "config": map[string]any{}}
	}},
	"retention": {read: "dataRetention.getRules", input: projectInput, marker: projectMarker, create: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "scope": projectScope(ctx), "category": "traces", "retentionDays": 63}
	}},
	"annotation": {read: "annotation.getByTraceId", marker: named("rehearsal"), input: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "traceId": ctx.TraceID}
	}, create: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "traceId": ctx.TraceID, "comment": "rehearsal " + ctx.Label, "isThumbsUp": true, "scoreOptions": map[string]any{}}
	}},
	"workflow": {read: "workflow.getAll", input: projectInput, marker: named("rehearsal workflow"), create: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "commitMessage": "rehearsal seed", "dsl": map[string]any{
			"spec_version": "1.4", "name": "rehearsal workflow " + ctx.Label, "icon": "🧪", "description": "upgrade rehearsal seed",
			"version": "1.0", "default_llm": map[string]any{"model": "openai/gpt-5"}, "template_adapter": "default",
			"enable_tracing": true, "nodes": []any{}, "edges": []any{}, "state": map[string]any{},
		}}
	}},
	"slack": {read: "slackIntegration.list", input: projectInput, marker: named("rehearsal slack"), create: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "name": "rehearsal slack " + ctx.Label, "kind": "INCOMING_WEBHOOK",
			"scopeType": "PROJECT", "scopeId": ctx.ProjectID, "secret": slackWebhook}
	}},
	"report": {read: "dashboards.getAll", input: projectInput, marker: named("rehearsal report"), create: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "name": "rehearsal report " + ctx.Label}
	}},
	"suite": {read: "suites.getAll", input: projectInput, marker: named("rehearsal suite"), create: func(ctx ProductContext) any {
		return map[string]any{"projectId": ctx.ProjectID, "name": "rehearsal suite " + ctx.Label}
	}},
}

// seedableKinds are the ProductKinds with a door and no reason to skip, in ProductKinds order.
func seedableKinds() []ProductKind {
	return slices.DeleteFunc(slices.Clone(ProductKinds), func(kind ProductKind) bool {
		_, ok := productDoors[kind.Kind]
		return kind.Unseedable != "" || !ok
	})
}

// Seeder writes the product kinds through the old app's own sign-in, tRPC and REST doors, never by SQL.
type Seeder struct {
	input   ProductInput
	cookie  string
	Context ProductContext
	// PlainWire: the release's tRPC carries plain JSON (head), not main's superjson {"json": ...}.
	PlainWire bool
}

// NewSeeder defaults the client to one with a minute's timeout per request.
func NewSeeder(input ProductInput) *Seeder {
	if input.Client == nil {
		input.Client = &http.Client{Timeout: time.Minute}
	}
	return &Seeder{input: input, Context: ProductContext{Label: input.Label}}
}

// Seed signs in, makes its own organization, project and trace, then creates every seedable kind.
// One refused kind never stops the others; the error names each refused kind.
func (seeder *Seeder) Seed(ctx context.Context) error {
	if err := seeder.signIn(ctx); err != nil {
		return err
	}
	if err := seeder.prepare(ctx); err != nil {
		return fmt.Errorf("prepare the seed project: %w", err)
	}
	var refused []error
	for _, kind := range seedableKinds() {
		call := trpcCall{mutation: true, path: kind.Create, input: productDoors[kind.Kind].create(seeder.Context)}
		if err := seeder.trpc(ctx, call); err != nil {
			refused = append(refused, fmt.Errorf("kind %s: %w", kind.Kind, err))
		}
	}
	return errors.Join(refused...)
}

// Count asks the app, per seedable kind, how many listed rows hold the seed's marker. A refused read
// counts 0 and is named in the error; the other kinds are still counted.
func (seeder *Seeder) Count(ctx context.Context) (map[string]int, error) {
	counts := map[string]int{}
	var refused []error
	for _, kind := range seedableKinds() {
		door := productDoors[kind.Kind]
		var answer json.RawMessage
		if err := seeder.trpc(ctx, trpcCall{path: door.read, input: door.input(seeder.Context), out: &answer}); err != nil {
			refused = append(refused, fmt.Errorf("count kind %s: %w", kind.Kind, err))
			counts[kind.Kind] = 0
			continue
		}
		counts[kind.Kind] = countHolding(answer, door.marker(seeder.Context))
	}
	return counts, errors.Join(refused...)
}

// countHolding counts a list answer's items holding marker; any other answer counts as one item.
func countHolding(answer json.RawMessage, marker string) int {
	var items []json.RawMessage
	if err := json.Unmarshal(answer, &items); err != nil {
		items = []json.RawMessage{answer}
	}
	count := 0
	for _, item := range items {
		if bytes.Contains(item, []byte(marker)) {
			count++
		}
	}
	return count
}

func (seeder *Seeder) signIn(ctx context.Context) error {
	body := map[string]string{"email": seeder.input.Email, "password": seeder.input.Password}
	header, _, err := seeder.send(ctx, wireCall{what: "sign in: POST /api/auth/sign-in/email", method: http.MethodPost, path: "/api/auth/sign-in/email", body: body, header: seeder.session()})
	if err != nil {
		return err
	}
	for _, value := range header.Values("Set-Cookie") {
		seeder.cookie = cmp.Or(seeder.cookie, sessionCookie.FindString(value))
	}
	if seeder.cookie == "" {
		return errors.New("sign in: the old app set no better-auth session cookie")
	}
	return nil
}

type organization struct {
	Teams []struct {
		Projects []project `json:"projects"`
	} `json:"teams"`
}

type project struct{ ID, Slug string }

func (seeder *Seeder) prepare(ctx context.Context) error {
	var created struct{ OrganizationID, ProjectSlug string }
	input := map[string]string{"orgName": "Rehearsal " + seeder.input.Label, "projectName": "rehearsal " + seeder.input.Label}
	if err := seeder.trpc(ctx, trpcCall{mutation: true, path: "onboarding.initializeOrganization", input: input, out: &created}); err != nil {
		return err
	}
	var organizations []organization
	if err := seeder.trpc(ctx, trpcCall{path: "organization.getAll", input: map[string]any{}, out: &organizations}); err != nil {
		return err
	}
	seeder.Context.OrganizationID, seeder.Context.ProjectID = created.OrganizationID, projectIn(organizations, created.ProjectSlug)
	if seeder.Context.ProjectID == "" {
		return errors.New("organization.getAll lists no project")
	}
	return seeder.ingestTrace(ctx)
}

// projectIn is the project with this slug, else the first listed, as product.mjs falls back.
func projectIn(organizations []organization, slug string) string {
	var projects []project
	for _, each := range organizations {
		for _, team := range each.Teams {
			projects = append(projects, team.Projects...)
		}
	}
	if index := slices.IndexFunc(projects, func(each project) bool { return each.Slug == slug }); index >= 0 {
		return projects[index].ID
	}
	if len(projects) == 0 {
		return ""
	}
	return projects[0].ID
}

func (seeder *Seeder) ingestTrace(ctx context.Context) error {
	var key struct{ APIKey string }
	if err := seeder.trpc(ctx, trpcCall{path: "project.getProjectAPIKey", input: projectInput(seeder.Context), out: &key}); err != nil {
		return err
	}
	seeder.Context.APIKey = key.APIKey
	seeder.Context.TraceID = "rehearsal-" + randomHex()
	now := time.Now().UnixMilli()
	span := map[string]any{"type": "span", "span_id": "span-" + randomHex(), "name": "rehearsal seed",
		"input":      map[string]string{"type": "text", "value": "seeded before the upgrade"},
		"timestamps": map[string]int64{"started_at": now - 1000, "finished_at": now}}
	body := map[string]any{"trace_id": seeder.Context.TraceID, "spans": []any{span}}
	_, _, err := seeder.send(ctx, wireCall{what: "POST /api/collector", method: http.MethodPost, path: "/api/collector", body: body, header: http.Header{"X-Auth-Token": {key.APIKey}}})
	return err
}

func randomHex() string {
	var data [16]byte
	_, _ = rand.Read(data[:])
	return hex.EncodeToString(data[:])
}

// trpcCall is one tRPC procedure in the superjson envelope; out, when set, receives result.data.json.
type trpcCall struct {
	mutation bool
	path     string
	input    any
	out      any
}

func (seeder *Seeder) trpc(ctx context.Context, call trpcCall) error {
	var envelope any = map[string]any{"json": call.input}
	if seeder.PlainWire {
		envelope = call.input
	}
	wire := wireCall{what: "query " + call.path, method: http.MethodGet, header: seeder.session()}
	if call.mutation {
		wire.what, wire.method, wire.path, wire.body = "mutation "+call.path, http.MethodPost, "/api/trpc/"+call.path, envelope
	} else {
		encoded, err := json.Marshal(envelope)
		if err != nil {
			return err
		}
		wire.path = "/api/trpc/" + call.path + "?input=" + url.QueryEscape(string(encoded))
	}
	_, text, err := seeder.send(ctx, wire)
	if err != nil || call.out == nil {
		return err
	}
	if seeder.PlainWire {
		var plain struct {
			Result struct {
				Data json.RawMessage `json:"data"`
			} `json:"result"`
		}
		if err := json.Unmarshal(text, &plain); err != nil {
			return fmt.Errorf("%s: %w", wire.what, err)
		}
		return json.Unmarshal(orNull(plain.Result.Data), call.out)
	}
	var answer struct {
		Result struct {
			Data struct {
				JSON json.RawMessage `json:"json"`
			} `json:"data"`
		} `json:"result"`
	}
	if err := json.Unmarshal(text, &answer); err != nil {
		return fmt.Errorf("%s: %w", wire.what, err)
	}
	return json.Unmarshal(orNull(answer.Result.Data.JSON), call.out)
}

func orNull(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage("null")
	}
	return raw
}

// Session is the signed-in seed account's headers (Origin and the session cookie), for callers that drive the app as it.
func (seeder *Seeder) Session() http.Header { return seeder.session() }

func (seeder *Seeder) session() http.Header {
	header := http.Header{"Origin": {seeder.input.AppURL}}
	if seeder.cookie != "" {
		header.Set("Cookie", seeder.cookie)
	}
	return header
}

// wireCall is one HTTP request to the old app; what names it in any error.
type wireCall struct {
	what, method, path string
	body               any
	header             http.Header
}

// send refuses a non-2xx status or a tRPC error envelope, quoting the answer's head.
func (seeder *Seeder) send(ctx context.Context, call wireCall) (http.Header, []byte, error) {
	request, err := seeder.request(ctx, call)
	if err != nil {
		return nil, nil, err
	}
	response, err := seeder.input.Client.Do(request)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", call.what, err)
	}
	defer func() { _ = response.Body.Close() }()
	text, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", call.what, err)
	}
	if response.StatusCode/100 != 2 || carriesError(text) {
		return nil, nil, fmt.Errorf("%s answered %d: %s", call.what, response.StatusCode, text[:min(len(text), answerTail)])
	}
	return response.Header, text, nil
}

func (seeder *Seeder) request(ctx context.Context, call wireCall) (*http.Request, error) {
	var body io.Reader = http.NoBody
	if call.body != nil {
		data, err := json.Marshal(call.body)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, call.method, seeder.input.AppURL+call.path, body)
	if err != nil {
		return nil, err
	}
	request.Header = call.header.Clone()
	request.Header.Set("Content-Type", "application/json")
	return request, nil
}

func carriesError(text []byte) bool {
	var envelope struct {
		Error json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(text, &envelope); err != nil {
		return false
	}
	return len(envelope.Error) > 0 && string(envelope.Error) != "null"
}
