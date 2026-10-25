package gateway

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// PricingDirEnv names the directory holding the app's model catalogue, the
// same variable langevals_core/model_pricing.py reads.
const PricingDirEnv = "LANGWATCH_MODEL_PRICING_DIR"

// catalogueFiles load in order; the overlay replaces a base entry whole.
var catalogueFiles = []string{"model-catalog.json", "model-catalog.overlay.json"}

var pricedModes = map[string]bool{"chat": true, "embedding": true}

type modelPrice struct {
	input, output         float64
	cacheRead, cacheWrite *float64
}

// Pricing prices a model call at the app's catalogue prices, the ones
// langevals registers with LiteLLM. A nil *Pricing prices nothing.
type Pricing struct {
	prices   map[string]modelPrice
	logger   *zap.Logger
	unpriced sync.Map
}

// LoadPricing reads the catalogue from dir once; a missing file is skipped,
// as in Python, and an unreadable one refuses to boot.
func LoadPricing(dir string, logger *zap.Logger) (*Pricing, error) {
	if logger == nil {
		logger = zap.NewNop()
	}
	models, err := readCatalogue(dir)
	if err != nil {
		return nil, err
	}
	prices := map[string]modelPrice{}
	for id, model := range models {
		if price, ok := priceOf(id, model); ok {
			prices[id] = price
		}
	}
	return &Pricing{prices: prices, logger: logger}, nil
}

// readCatalogue merges the catalogue files by model id.
func readCatalogue(dir string) (map[string]map[string]any, error) {
	models := map[string]map[string]any{}
	for _, name := range catalogueFiles {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("model pricing: %w", err)
		}
		var catalogue struct {
			Models map[string]map[string]any `json:"models"`
		}
		if err := json.Unmarshal(raw, &catalogue); err != nil {
			return nil, fmt.Errorf("model pricing %s: %w", name, err)
		}
		for id, model := range catalogue.Models {
			models[id] = model
		}
	}
	return models, nil
}

// priceOf is to_litellm_cost_map for one entry: chat and embedding only, no
// "~" alias, and nothing without an input price.
func priceOf(id string, model map[string]any) (modelPrice, bool) {
	mode := "chat"
	if raw, ok := model["mode"]; ok {
		mode, _ = raw.(string)
	}
	provider, _ := model["provider"].(string)
	if provider == "" {
		provider, _, _ = strings.Cut(id, "/")
	}
	if !pricedModes[mode] || strings.HasPrefix(provider, "~") {
		return modelPrice{}, false
	}
	pricing, _ := model["pricing"].(map[string]any)
	input, ok := pricing["inputCostPerToken"].(float64)
	if !ok {
		return modelPrice{}, false
	}
	output, _ := pricing["outputCostPerToken"].(float64)
	return modelPrice{
		input:      input,
		output:     output,
		cacheRead:  number(pricing["inputCacheReadPerToken"]),
		cacheWrite: number(pricing["inputCacheWritePerToken"]),
	}, true
}

func number(value any) *float64 {
	if n, ok := value.(float64); ok {
		return &n
	}
	return nil
}

// Len is how many models the catalogue prices.
func (p *Pricing) Len() int {
	if p == nil {
		return 0
	}
	return len(p.prices)
}

// Cost prices usage at the first key the catalogue knows; nil when none is.
func (p *Pricing) Cost(keys []string, usage domain.Usage) *float64 {
	if p == nil || len(keys) == 0 {
		return nil
	}
	for _, key := range keys {
		if price, ok := p.prices[key]; ok {
			cost := price.cost(usage)
			return &cost
		}
	}
	if _, warned := p.unpriced.LoadOrStore(keys[0], true); !warned {
		p.logger.Warn("evaluator_model_unpriced", zap.String("model", keys[0]))
	}
	return nil
}

// cost follows LiteLLM's generic_cost_per_token: the prompt total holds the
// cached tokens, so they come out of it, and a missing cache price is the
// input price. Audio and image counts are disjoint from the totals.
func (m modelPrice) cost(usage domain.Usage) float64 {
	cacheRead, cacheWrite := m.input, m.input
	if m.cacheRead != nil {
		cacheRead = *m.cacheRead
	}
	if m.cacheWrite != nil {
		cacheWrite = *m.cacheWrite
	}
	fresh := max(usage.PromptTokens-usage.CacheReadTokens-usage.CacheCreationTokens, 0)
	prompt := float64(fresh) * m.input
	prompt += float64(usage.CacheReadTokens) * cacheRead
	prompt += float64(usage.InputAudioTokens+usage.InputImageTokens) * m.input
	prompt += float64(usage.CacheCreationTokens) * cacheWrite
	completion := float64(usage.CompletionTokens+usage.OutputAudioTokens+usage.OutputImageTokens) * m.output
	return prompt + completion
}
