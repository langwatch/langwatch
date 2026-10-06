package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// SetupStep is one API call a flow's `setup:` makes before the flow runs, so a
// prerequisite is posted instead of clicked through: Post is the path (its {name} filled too), Body its JSON
// with {name} filled from the fixtures and earlier captures, As names the strings
// kept from the answer (value name to dot path). A flow reads them as {name}.
// A step with a Bearer goes to the stack's gateway origin carrying that virtual key
// secret, so a flow can make a real model call through the data plane. A step with
// `auth: scim` goes to the API origin carrying the stack's seeded SCIM token as its
// bearer, and the flow's steps read that token as {scimToken}.
type SetupStep struct {
	Post   string            `yaml:"post"`
	Body   map[string]any    `yaml:"body,omitempty"`
	As     map[string]string `yaml:"as,omitempty"`
	Bearer string            `yaml:"bearer,omitempty"`
	Auth   string            `yaml:"auth,omitempty"`
}

// SetupAuthScim is the one `auth:` a setup step names, and FixtureScimToken the
// value name the token answers to inside a flow's setup.
const (
	SetupAuthScim    = "scim"
	FixtureScimToken = "scimToken"
)

// setupRequest is every flow's setup against one stack, with that stack's fixtures.
type setupRequest struct {
	client   *http.Client
	apiURL   string
	key      string
	fixtures map[string]string
	flows    []Flow
	// scimToken is the stack's seeded SCIM token, kept out of the fixtures so it
	// is never recorded; empty when the stack has none.
	scimToken string
}

// runFlowSetups posts every flow's setup at once through the seed's client, each
// flow's own steps in order and in its own project, and returns the captures filed
// as `<flow id>/<name>` (runner flowValues). A flow whose setup fails is a warning;
// the flow then fails on its own steps.
func runFlowSetups(ctx context.Context, request setupRequest) (map[string]string, []string) {
	if request.client == nil {
		request.client = seedClient()
	}
	captured := map[string]string{}
	var warnings []string
	var mutex sync.Mutex
	group := errgroup.Group{}
	group.SetLimit(seedConcurrency)
	for index := range request.flows {
		flow := request.flows[index]
		if len(flow.Setup) == 0 {
			continue
		}
		key := request.key
		if flow.Isolated && request.fixtures[FixtureIsolatedKey] != "" {
			key = request.fixtures[FixtureIsolatedKey]
		}
		group.Go(func() error {
			values, err := runSetup(ctx, request, setupTarget{key: key, flow: flow})
			mutex.Lock()
			defer mutex.Unlock()
			maps.Copy(captured, values)
			if err != nil {
				warnings = append(warnings, fmt.Sprintf("setup %s: %v", flow.ID, err))
			}
			return nil
		})
	}
	_ = group.Wait()
	return captured, warnings
}

// setupTarget is one flow's setup and the project key it posts with.
type setupTarget struct {
	key  string
	flow Flow
}

// runSetup walks one flow's setup and returns what it captured, under the flow's id.
func runSetup(ctx context.Context, request setupRequest, target setupTarget) (map[string]string, error) {
	values := map[string]string{"uid": fmt.Sprintf("%x", time.Now().UnixNano()%0xfffff)}
	maps.Copy(values, request.fixtures)
	if request.scimToken != "" {
		values[FixtureScimToken] = request.scimToken
	}
	walk := &setupWalk{request: request, key: target.key, flowID: target.flow.ID, values: values,
		captured: map[string]string{target.flow.ID + "/uid": values["uid"]}}
	for index, step := range target.flow.Setup {
		if err := walk.step(ctx, index, step); err != nil {
			return walk.captured, err
		}
	}
	return walk.captured, nil
}

// setupWalk is one flow's setup in progress: the values its later steps read
// and the captures filed under the flow's id.
type setupWalk struct {
	request  setupRequest
	key      string
	flowID   string
	values   map[string]string
	captured map[string]string
}

// step posts one setup step and keeps the values it names.
func (walk *setupWalk) step(ctx context.Context, index int, step SetupStep) error {
	body, err := fillBody(step.Body, walk.values)
	if err != nil {
		return fmt.Errorf("step %d: %w", index, err)
	}
	path := fillText(step.Post, walk.values)
	origin, bearer, err := walk.destination(step)
	if err != nil {
		return fmt.Errorf("step %d: %w", index, err)
	}
	answer, err := postReading(ctx, walk.request.client, postSpec{url: origin + path, key: walk.key, body: body, bearer: bearer})
	if err != nil {
		return fmt.Errorf("step %d: %w", index, err)
	}
	for name, path := range step.As {
		value, err := StringAt(answer, path)
		if err != nil {
			return fmt.Errorf("step %d %s: %w", index, name, err)
		}
		walk.values[name] = value
		walk.captured[walk.flowID+"/"+name] = value
	}
	return nil
}

// destination is the origin a step posts to and the bearer it carries: the API
// origin, with the SCIM token under `auth: scim`, or the gateway origin with
// the step's own virtual key secret.
func (walk *setupWalk) destination(step SetupStep) (origin, bearer string, err error) {
	apiURL := walk.request.apiURL
	origin = apiURL
	switch step.Auth {
	case "":
	case SetupAuthScim:
		if walk.request.scimToken == "" {
			return "", "", errors.New("auth scim, but this stack has no seeded SCIM token")
		}
		bearer = walk.request.scimToken
	default:
		return "", "", fmt.Errorf("unknown auth %q", step.Auth)
	}
	if step.Bearer == "" {
		return origin, bearer, nil
	}
	origin = Stack{HavenURL: apiURL}.GatewayURL()
	if origin == "" {
		return "", "", fmt.Errorf("%s has no gateway origin", apiURL)
	}
	return origin, fillText(step.Bearer, walk.values), nil
}

// fillBody substitutes each {name} in the body's strings, JSON-escaped.
func fillBody(body map[string]any, values map[string]string) (any, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	text := string(encoded)
	for name, value := range values {
		escaped, _ := json.Marshal(value)
		text = strings.ReplaceAll(text, "{"+name+"}", strings.Trim(string(escaped), `"`))
	}
	var filled any
	err = json.Unmarshal([]byte(text), &filled)
	return filled, err
}

// fillText substitutes each {name} in text with its value.
func fillText(text string, values map[string]string) string {
	for name, value := range values {
		text = strings.ReplaceAll(text, "{"+name+"}", value)
	}
	return text
}

// scimTokenRequest is where stackScimToken asks: haven through run, in the
// environment environ answers, for stack, when one of flows needs the token.
type scimTokenRequest struct {
	run     runner
	environ func() []string
	stack   Stack
	flows   []Flow
}

// stackScimToken reads the SCIM token haven minted for the stack, through
// `haven env --json --reveal` and never printed. It asks only when a flow's setup
// uses one, and answers "" when the stack has none or haven will not say.
func stackScimToken(ctx context.Context, request scimTokenRequest) string {
	run, stack := request.run, request.stack
	if stack.HavenSlug == "" || !setupUsesScim(request.flows) {
		return ""
	}
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: []string{"env", "--json", "--reveal"}, dir: stack.Dir, env: havenEnv(request.environ(), stack.HavenSlug)}
	if err := run(ctx, spec, &out); err != nil {
		return ""
	}
	return scimTokenIn(out.Bytes())
}

// scimTokenIn is the HAVEN_SEED_SCIM_TOKEN in haven's JSON overlay, which may be
// preceded by log lines on the same stream.
func scimTokenIn(output []byte) string {
	start := bytes.IndexByte(output, '{')
	if start < 0 {
		return ""
	}
	overlay := map[string]string{}
	if json.NewDecoder(bytes.NewReader(output[start:])).Decode(&overlay) != nil {
		return ""
	}
	return overlay["HAVEN_SEED_SCIM_TOKEN"]
}

func setupUsesScim(flows []Flow) bool {
	for _, flow := range flows {
		for _, step := range flow.Setup {
			if step.Auth == SetupAuthScim {
				return true
			}
		}
	}
	return false
}
