package visualdiff

import (
	"encoding/json"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// CatalogueFile is the module catalogue, relative to the repository root. A
// finding's module is a guess derived from it, not the authoritative feature
// map: the match is a route-segment heuristic, so an unmatched route or flow
// reports an empty module rather than a wrong one.
const CatalogueFile = "modules/catalogue.json"

// ModuleIndex maps a route segment (a module's directory name) to the module
// id owning its screens.
type ModuleIndex map[string]string

// LoadModuleIndex reads the catalogue under root and indexes every module by
// its directory name ("modules/analytics" -> "analytics").
func LoadModuleIndex(root string) (ModuleIndex, error) {
	data, err := os.ReadFile(filepath.Join(root, CatalogueFile)) // #nosec G304 -- root is the tool's own -root flag; the joined path is a fixed repository file.
	if err != nil {
		return nil, err
	}
	var document struct {
		Features []struct {
			ID   string `json:"id"`
			Root string `json:"root"`
		} `json:"features"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return nil, err
	}
	index := ModuleIndex{}
	for _, feature := range document.Features {
		if feature.ID == "" || feature.Root == "" {
			continue
		}
		index[path.Base(feature.Root)] = feature.ID
	}
	return index, nil
}

// lookup finds the module owning a route's or flow's first path segment,
// trying the plural too: the catalogue's own "root" values are not
// consistently singular or plural ("annotation" for the "annotations"
// route). Empty when no feature claims the segment.
func (index ModuleIndex) lookup(segment string) string {
	if segment == "" {
		return ""
	}
	if module, ok := index[segment]; ok {
		return module
	}
	if trimmed := strings.TrimSuffix(segment, "s"); trimmed != segment {
		if module, ok := index[trimmed]; ok {
			return module
		}
	}
	return ""
}

// routeModuleKey extracts a route's first real path segment, after removing
// the {slug} placeholder every visualdiff.yaml route carries.
func routeModuleKey(route string) string {
	trimmed := strings.ReplaceAll(route, "{slug}/", "")
	trimmed = strings.TrimPrefix(trimmed, "{slug}")
	trimmed = strings.TrimPrefix(trimmed, "/")
	segment, _, _ := strings.Cut(trimmed, "/")
	return segment
}

// moduleKey extracts the lookup segment from a Capture's key: a route path
// (routeModuleKey) or a flow id, best-effort read as the text before its
// first hyphen ("prompt-create" -> "prompt").
func moduleKey(key string) string {
	if strings.HasPrefix(key, "/") {
		return routeModuleKey(key)
	}
	segment, _, _ := strings.Cut(key, "-")
	return segment
}
