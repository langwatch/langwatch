package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
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
			values, err := runSetup(ctx, request, key, flow)
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

// runSetup walks one flow's setup and returns what it captured, under the flow's id.
func runSetup(ctx context.Context, request setupRequest, key string, flow Flow) (map[string]string, error) {
	values := map[string]string{"uid": fmt.Sprintf("%x", time.Now().UnixNano()%0xfffff)}
	maps.Copy(values, request.fixtures)
	if request.scimToken != "" {
		values[FixtureScimToken] = request.scimToken
	}
	captured := map[string]string{}
	for index, step := range flow.Setup {
		body, err := fillBody(step.Body, values)
		if err != nil {
			return captured, fmt.Errorf("step %d: %w", index, err)
		}
		path := fillText(step.Post, values)
		origin, bearer := request.apiURL, ""
		switch step.Auth {
		case "":
		case SetupAuthScim:
			if request.scimToken == "" {
				return captured, fmt.Errorf("step %d: auth scim, but this stack has no seeded SCIM token", index)
			}
			bearer = request.scimToken
		default:
			return captured, fmt.Errorf("step %d: unknown auth %q", index, step.Auth)
		}
		if step.Bearer != "" {
			origin = Stack{HavenURL: request.apiURL}.GatewayURL()
			bearer = fillText(step.Bearer, values)
			if origin == "" {
				return captured, fmt.Errorf("step %d: %s has no gateway origin", index, request.apiURL)
			}
		}
		answer, err := postReading(ctx, request.client, postSpec{url: origin + path, key: key, body: body, bearer: bearer})
		if err != nil {
			return captured, fmt.Errorf("step %d: %w", index, err)
		}
		for name, path := range step.As {
			value, err := StringAt(answer, path)
			if err != nil {
				return captured, fmt.Errorf("step %d %s: %w", index, name, err)
			}
			values[name] = value
			captured[flow.ID+"/"+name] = value
		}
	}
	return captured, nil
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

// stackScimToken reads the SCIM token haven minted for the stack, through
// `haven env --json --reveal` and never printed. It asks only when a flow's setup
// uses one, and answers "" when the stack has none or haven will not say.
func stackScimToken(ctx context.Context, run runner, environ func() []string, stack Stack, flows []Flow) string {
	if stack.HavenSlug == "" || !setupUsesScim(flows) {
		return ""
	}
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: []string{"env", "--json", "--reveal"}, dir: stack.Dir, env: havenEnv(environ(), stack.HavenSlug)}
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
