package a2aproxy

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// serveCard fetches the target's Agent Card and points every interface URL
// at the gateway, so a client that reads the card keeps calling through it.
func (h *Handler) serveCard(c *call, target domain.A2ATarget) {
	ctx := c.ctx
	cardURL := target.CardURL
	if cardURL == "" {
		cardURL = strings.TrimSuffix(target.UpstreamURL, "/") + cardPath
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cardURL, nil)
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the Agent Card URL is invalid"))
		return
	}
	for k, v := range target.UpstreamHeaders {
		req.Header.Set(k, v)
	}
	propagation.TraceContext{}.Inject(ctx, propagation.HeaderCarrier(req.Header))
	resp, err := h.cfg.Client.Do(req)
	if err != nil {
		c.refuse(refuseUpstream)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	var card map[string]any
	if err != nil || resp.StatusCode != http.StatusOK || json.Unmarshal(raw, &card) != nil {
		c.refuse(refuseUpstream.withMessage("the A2A agent has no readable Agent Card"))
		return
	}
	if target.AgentName == "" {
		if name, ok := card["name"].(string); ok && name != "" {
			c.span.SetAttributes(attribute.String(attrAgentName, name))
		}
	}
	rewriteCard(card, strings.TrimSuffix(target.UpstreamURL, "/"), proxyBase(c.r, target.Name))
	out, _ := json.Marshal(card)
	c.w.Header().Set("Content-Type", "application/json")
	c.w.WriteHeader(http.StatusOK)
	_, _ = c.w.Write(out)
}

// rewriteCard swaps the upstream base for the proxy base in the card's url
// and every interface url (v1.0 supportedInterfaces, v0.3 additionalInterfaces).
// A url outside the upstream base becomes the proxy base itself.
func rewriteCard(card map[string]any, upstream, proxy string) {
	rewrite := func(u string) string {
		if suffix, ok := strings.CutPrefix(u, upstream); ok && (suffix == "" || strings.HasPrefix(suffix, "/")) {
			return proxy + suffix
		}
		return proxy
	}
	rewriteURL(card, rewrite)
	for _, key := range []string{"supportedInterfaces", "additionalInterfaces"} {
		list, _ := card[key].([]any)
		for _, item := range list {
			if iface, ok := item.(map[string]any); ok {
				rewriteURL(iface, rewrite)
			}
		}
	}
}

func rewriteURL(m map[string]any, rewrite func(string) string) {
	if u, ok := m["url"].(string); ok {
		m["url"] = rewrite(u)
	}
}

func proxyBase(r *http.Request, target string) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p == "http" || p == "https" {
		scheme = p
	}
	return scheme + "://" + r.Host + strings.TrimSuffix(PathPrefix, "/") + "/" + target
}

// StaticRegistry holds targets per project in memory. It backs tests and a
// gateway with no control-plane registry yet.
type StaticRegistry struct {
	mu      sync.RWMutex
	targets map[string]domain.A2ATarget
}

// NewStaticRegistry returns an empty registry.
func NewStaticRegistry() *StaticRegistry {
	return &StaticRegistry{targets: map[string]domain.A2ATarget{}}
}

// Put registers or replaces a target for a project.
func (s *StaticRegistry) Put(projectID string, target domain.A2ATarget) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.targets[projectID+"/"+target.Name] = target
}

// Lookup implements Registry.
func (s *StaticRegistry) Lookup(_ context.Context, bundle *domain.Bundle, name string) (domain.A2ATarget, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.targets[bundle.ProjectID+"/"+name]
	if !ok {
		return domain.A2ATarget{}, domain.ErrA2ATargetNotFound
	}
	return t, nil
}

// BundleRegistry finds targets in the caller's config bundle, which the
// control plane fills from the project's A2A target registry.
type BundleRegistry struct{}

// Lookup implements Registry.
func (BundleRegistry) Lookup(_ context.Context, bundle *domain.Bundle, name string) (domain.A2ATarget, error) {
	if bundle != nil {
		for _, t := range bundle.Config.A2ATargets {
			if t.Name == name {
				return t, nil
			}
		}
	}
	return domain.A2ATarget{}, domain.ErrA2ATargetNotFound
}
