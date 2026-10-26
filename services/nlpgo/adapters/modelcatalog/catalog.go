// Package modelcatalog reads what LangWatch's model catalog records about how
// a model takes a request. It is the same catalog the app and langevals read
// (modules/model-provider/contract/src/catalog), so the engine learns a model's
// capabilities from its catalog entry rather than from its name.
package modelcatalog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DirEnv names the directory the runtime images copy the catalog files into.
const DirEnv = "LANGWATCH_MODEL_CATALOG_DIR"

const (
	baseFile    = "model-catalog.json"
	overlayFile = "model-catalog.overlay.json"
	checkoutDir = "modules/model-provider/contract/src/catalog"

	defaultOutputTokensParameter = "max_tokens"
)

type entry struct {
	OutputTokensParameter string `json:"outputTokensParameter"`
}

type catalogFile struct {
	Models map[string]entry `json:"models"`
}

// Catalog is the merged catalog, keyed by model id. A nil Catalog knows no
// model.
type Catalog struct {
	models map[string]entry
}

// Load reads the catalog and its overlay from dir. The overlay wins on a
// shared id, the rule the app applies. The overlay may be absent; the catalog
// may not.
func Load(dir string) (*Catalog, error) {
	models := map[string]entry{}
	for _, name := range []string{baseFile, overlayFile} {
		file, err := readFile(dir, name)
		if err != nil {
			return nil, err
		}
		for id, model := range file.Models {
			models[id] = model
		}
	}
	return &Catalog{models: models}, nil
}

// readFile reads one catalog file. A missing overlay reads as empty.
func readFile(dir, name string) (catalogFile, error) {
	var file catalogFile
	raw, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		if name == overlayFile && os.IsNotExist(err) {
			return file, nil
		}
		return file, fmt.Errorf("read model catalog %s: %w", name, err)
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		return file, fmt.Errorf("parse model catalog %s: %w", name, err)
	}
	return file, nil
}

// FindDir walks up from start to the checkout's catalog directory, the one a
// development run reads when DirEnv is not set.
func FindDir(start string) (string, bool) {
	for dir := start; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, checkoutDir)
		if _, err := os.Stat(filepath.Join(candidate, baseFile)); err == nil {
			return candidate, true
		}
		if filepath.Dir(dir) == dir {
			return "", false
		}
	}
}

// OutputTokensParameter is the request parameter modelID takes its output
// token limit as, and whether the catalog carries the model at all. An Azure
// deployment serves an OpenAI model, so `azure/<name>` is looked up as
// `openai/<name>`.
func (c *Catalog) OutputTokensParameter(modelID string) (string, bool) {
	model, ok := c.find(modelID)
	if !ok {
		return "", false
	}
	if model.OutputTokensParameter == "" {
		return defaultOutputTokensParameter, true
	}
	return model.OutputTokensParameter, true
}

func (c *Catalog) find(modelID string) (entry, bool) {
	if c == nil {
		return entry{}, false
	}
	if model, ok := c.models[modelID]; ok {
		return model, true
	}
	if name, ok := strings.CutPrefix(modelID, "azure/"); ok {
		model, found := c.models["openai/"+name]
		return model, found
	}
	return entry{}, false
}
