// Package modelcapsgen mirrors the endpoint-scoped reasoning capabilities
// declared in the TypeScript model registry into the Go table that nlpgo
// enforces at dispatch.
//
// The registry is the single place a model's capabilities are curated, and
// it is regenerated periodically from an upstream catalog. nlpgo cannot
// read it directly: `go:embed` refuses paths outside the package, and the
// deployed nlpgo image does not ship the control plane's source tree. So
// the relevant slice is generated into Go source instead, which means a
// future model that rejects reasoning alongside function tools is adopted
// by editing `llmModels.json` and re-running the generator, with no
// hand-written dispatch code touched.
//
// Same shape as tools/herrgen, in the other direction.
package modelcapsgen

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
)

// DefaultRegistry is the model registry the capabilities are read from,
// relative to the repository root.
const DefaultRegistry = "platform/app/src/server/modelProviders/llmModels.json"

// DefaultOut is the generated Go file, relative to the repository root.
const DefaultOut = "services/nlpgo/adapters/litellm/reasoningcaps.generated.go"

// knownEndpoints mirrors the ModelEndpoint union in llmModels.types.ts. A
// value outside it is a typo that would otherwise generate a table entry
// no dispatcher can ever match, so the generator rejects it.
var knownEndpoints = []string{"chat_completions", "responses", "messages"}

// Capability is one model's endpoint-scoped reasoning/tools conflict, as
// the generated Go table needs it.
type Capability struct {
	// ModelID is the registry key, e.g. "openai/gpt-5.6-sol".
	ModelID string
	// ConflictEndpoints are the endpoints on which the provider rejects
	// reasoning combined with function tools, sorted.
	ConflictEndpoints []string
	// CanDisable reports whether reasoning can be turned off, which is
	// what decides whether the conflict is fixable at dispatch.
	CanDisable bool
}

// reasoningConfig is the slice of ReasoningConfig (llmModels.types.ts)
// this generator reads. The other fields are the UI's business.
type reasoningConfig struct {
	Supported           bool     `json:"supported"`
	CanDisable          bool     `json:"canDisable"`
	ToolsIncompatibleOn []string `json:"toolsIncompatibleOn"`
}

type registryFile struct {
	Models map[string]struct {
		ReasoningConfig *reasoningConfig `json:"reasoningConfig"`
	} `json:"models"`
}

// ReadCapabilities parses the registry at path and returns every model that
// declares an endpoint-scoped reasoning/tools conflict, sorted by model id.
//
// A declaration on a model that does not support reasoning, or that names
// an endpoint outside the known set, is a curation mistake rather than
// something to render: it would ship a table entry that either contradicts
// itself or can never match. Both are returned as errors.
func ReadCapabilities(path string) ([]Capability, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read model registry: %w", err)
	}
	var parsed registryFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("parse model registry %s: %w", path, err)
	}
	if len(parsed.Models) == 0 {
		return nil, fmt.Errorf("model registry %s holds no models", path)
	}

	capabilities := make([]Capability, 0, 8)
	for id, entry := range parsed.Models {
		capability, declared, err := capabilityFor(id, entry.ReasoningConfig)
		if err != nil {
			return nil, err
		}
		if declared {
			capabilities = append(capabilities, capability)
		}
	}
	slices.SortFunc(capabilities, func(a, b Capability) int {
		return strings.Compare(a.ModelID, b.ModelID)
	})
	return capabilities, nil
}

// capabilityFor converts one registry entry's reasoning config into a
// Capability. The second return says whether the entry declares a conflict
// at all — the overwhelming majority do not.
func capabilityFor(id string, reasoning *reasoningConfig) (Capability, bool, error) {
	if reasoning == nil || len(reasoning.ToolsIncompatibleOn) == 0 {
		return Capability{}, false, nil
	}
	if !reasoning.Supported {
		return Capability{}, false, fmt.Errorf(
			"%s declares toolsIncompatibleOn but does not support reasoning", id)
	}
	endpoints, err := normalizeEndpoints(id, reasoning.ToolsIncompatibleOn)
	if err != nil {
		return Capability{}, false, err
	}
	return Capability{
		ModelID:           id,
		ConflictEndpoints: endpoints,
		CanDisable:        reasoning.CanDisable,
	}, true, nil
}

func normalizeEndpoints(modelID string, declared []string) ([]string, error) {
	endpoints := make([]string, 0, len(declared))
	for _, endpoint := range declared {
		if !slices.Contains(knownEndpoints, endpoint) {
			return nil, fmt.Errorf(
				"%s declares unknown endpoint %q; known endpoints are %s",
				modelID, endpoint, strings.Join(knownEndpoints, ", "))
		}
		endpoints = append(endpoints, endpoint)
	}
	slices.Sort(endpoints)
	return slices.Compact(endpoints), nil
}
