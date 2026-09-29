package visualdiff

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
)

// SetupStep is one API call a flow's `setup:` makes before the flow runs, so a
// prerequisite is posted instead of clicked through: Post is the path, Body its JSON
// with {name} filled from the fixtures and earlier captures, As names the strings
// kept from the answer (value name to dot path). A flow reads them as {name}.
type SetupStep struct {
	Post string            `yaml:"post"`
	Body map[string]any    `yaml:"body,omitempty"`
	As   map[string]string `yaml:"as,omitempty"`
}

// setupRequest is every flow's setup against one stack, with that stack's fixtures.
type setupRequest struct {
	client   *http.Client
	apiURL   string
	key      string
	fixtures map[string]string
	flows    []Flow
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
	captured := map[string]string{}
	for index, step := range flow.Setup {
		body, err := fillBody(step.Body, values)
		if err != nil {
			return captured, fmt.Errorf("step %d: %w", index, err)
		}
		answer, err := postReading(ctx, request.client, postSpec{url: request.apiURL + step.Post, key: key, body: body})
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
