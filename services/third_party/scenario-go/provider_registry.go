package scenario

import (
	"fmt"
	"slices"
	"strings"
	"sync"
)

// ProviderOptions configure the LLM a ProviderFactory builds. Empty fields
// fall back to the provider's own environment variables (OPENAI_API_KEY,
// ANTHROPIC_API_KEY, GEMINI_API_KEY, AWS_*, …).
type ProviderOptions struct {
	// Provider is the registry name the model string used, such as "openai"
	// or "azure", so one factory can serve several names.
	Provider string
	// APIKey overrides the provider's API key.
	APIKey string
	// BaseURL overrides the provider's endpoint.
	BaseURL string
	// Headers are sent with every request.
	Headers map[string]string
}

// ProviderFactory builds the LLM of a provider. The registry calls it once
// per distinct ProviderOptions and reuses the LLM, so a factory should only
// build a client, never call the network.
type ProviderFactory func(ProviderOptions) (LLM, error)

// providerRegistry maps provider names to factories and caches the LLMs
// built from them. Nothing is registered by default: provider modules
// expose their factories and the user registers the ones they use, so
// importing scenario costs no client set-up.
var providerRegistry struct {
	mu        sync.RWMutex
	factories map[string]ProviderFactory
	built     map[string]LLM
	// gen counts registrations, so an LLM built by a factory replaced
	// meanwhile is not cached.
	gen uint64
}

// RegisterProvider makes "name/model" strings resolve through factory, for
// example scenario.RegisterProvider("openai", openai.Factory). Names are
// case-insensitive; registering a name again replaces it, and a nil factory
// removes it. Safe for concurrent use.
func RegisterProvider(name string, factory ProviderFactory) {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return
	}
	r := &providerRegistry
	r.mu.Lock()
	defer r.mu.Unlock()
	if factory == nil {
		delete(r.factories, name)
	} else {
		if r.factories == nil {
			r.factories = map[string]ProviderFactory{}
		}
		r.factories[name] = factory
	}
	r.built = nil // LLMs built by a replaced factory must not be reused
	r.gen++
}

// RegisteredProviders returns the registered provider names, sorted.
func RegisteredProviders() []string {
	r := &providerRegistry
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.factories))
	for name := range r.factories {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// SplitModel splits a "provider/model" string at its first slash, so
// "openrouter/anthropic/claude-sonnet-4.5" names provider "openrouter" and
// model "anthropic/claude-sonnet-4.5". A string without a slash has no
// provider.
func SplitModel(model string) (provider, name string) {
	p, n, ok := strings.Cut(model, "/")
	if !ok {
		return "", model
	}
	return strings.ToLower(p), n
}

// registeredProvider returns the provider part of model when it names a
// registered provider, else "".
func registeredProvider(model string) string {
	p, _ := SplitModel(model)
	if p == "" {
		return ""
	}
	r := &providerRegistry
	r.mu.RLock()
	_, ok := r.factories[p]
	r.mu.RUnlock()
	if !ok {
		return ""
	}
	return p
}

// Resolve returns c ready to call: when LLM is nil, Model must be a
// "provider/model" string naming a registered provider, and the result
// carries that provider's LLM and the bare model name. A config with an LLM
// is returned unchanged. The LLM is built once per provider, key, endpoint
// and headers, and shared afterwards.
func (c ModelConfig) Resolve() (ModelConfig, error) {
	if c.LLM != nil {
		return c, nil
	}
	provider, name := SplitModel(c.Model)
	if provider == "" || name == "" {
		return c, ErrNoModel
	}
	llm, err := buildProvider(ProviderOptions{Provider: provider, APIKey: c.APIKey, BaseURL: c.BaseURL, Headers: c.Headers})
	if err != nil {
		return c, err
	}
	c.LLM, c.Model = llm, name
	return c, nil
}

func buildProvider(opts ProviderOptions) (LLM, error) {
	key := opts.cacheKey()
	r := &providerRegistry
	r.mu.RLock()
	factory, ok := r.factories[opts.Provider]
	llm, gen := r.built[key], r.gen
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: provider %q is not registered; register it once with scenario.RegisterProvider(%q, <provider module>.Factory) using a module under github.com/langwatch/scenario/go/providers", ErrNoModel, opts.Provider, opts.Provider)
	}
	if llm != nil {
		return llm, nil
	}
	llm, err := factory(opts)
	if err != nil {
		return nil, fmt.Errorf("provider %q: %w", opts.Provider, err)
	}
	if llm == nil {
		return nil, fmt.Errorf("provider %q: factory returned no LLM", opts.Provider)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.gen != gen {
		return llm, nil // the registry changed meanwhile: use once, do not cache
	}
	if existing := r.built[key]; existing != nil {
		return existing, nil // a concurrent call built it first
	}
	if r.built == nil {
		r.built = map[string]LLM{}
	}
	r.built[key] = llm
	return llm, nil
}

// cacheKey identifies the LLM built for the options.
func (o ProviderOptions) cacheKey() string {
	var b strings.Builder
	b.WriteString(o.Provider)
	b.WriteByte(0)
	b.WriteString(o.APIKey)
	b.WriteByte(0)
	b.WriteString(o.BaseURL)
	keys := make([]string, 0, len(o.Headers))
	for k := range o.Headers {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		b.WriteByte(0)
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(o.Headers[k])
	}
	return b.String()
}
