package a2aproxy

import (
	"context"
	"encoding/json"
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
	card, ok := h.fetchCard(c, target)
	if !ok {
		return
	}
	if target.AgentName == "" {
		if name, isName := card["name"].(string); isName && name != "" {
			c.span.SetAttributes(attribute.String(attrAgentName, name))
		}
	}
	rewriteCard(card, target.UpstreamURL, proxyBase(h.cfg.PublicBaseURL, c.r, target.Name))
	out, _ := json.Marshal(card)
	c.w.Header().Set("Content-Type", "application/json")
	c.w.WriteHeader(http.StatusOK)
	_, _ = c.w.Write(out)
}

// fetchCard reads the upstream Agent Card, refusing the call when it cannot.
func (h *Handler) fetchCard(c *call, target domain.A2ATarget) (map[string]any, bool) {
	cardURL := target.CardURL
	if cardURL == "" {
		cardURL = upstreamEndpoint(target.UpstreamURL, cardPath, "")
	}
	req, err := http.NewRequestWithContext(c.ctx, http.MethodGet, cardURL, nil)
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the Agent Card URL is invalid"))
		return nil, false
	}
	for k, v := range target.UpstreamHeaders {
		req.Header.Set(k, v)
	}
	propagation.TraceContext{}.Inject(c.ctx, propagation.HeaderCarrier(req.Header))
	resp, err := h.cfg.Client.Do(req)
	if err != nil {
		c.refuse(upstreamRefusal(err))
		return nil, false
	}
	defer func() { _ = resp.Body.Close() }()
	raw, tooLarge, err := readLimited(resp.Body)
	if tooLarge {
		c.refuse(refuseReplyTooLarge)
		return nil, false
	}
	var card map[string]any
	if err != nil || resp.StatusCode != http.StatusOK || json.Unmarshal(raw, &card) != nil {
		c.refuse(refuseUpstream.withMessage("the A2A agent has no readable Agent Card"))
		return nil, false
	}
	return card, true
}

// rewriteCard points the card at the proxy. The proxy serves one endpoint per
// target, the upstream URL, so the card's url becomes the proxy base, an
// interface at the upstream URL does too, and every other interface (another
// path or host the proxy does not serve) is dropped.
func rewriteCard(card map[string]any, upstream, proxy string) {
	card["url"] = proxy
	for _, key := range []string{"supportedInterfaces", "additionalInterfaces"} {
		list, isList := card[key].([]any)
		if !isList {
			continue
		}
		kept := make([]any, 0, len(list))
		for _, item := range list {
			iface, ok := item.(map[string]any)
			if u, _ := iface["url"].(string); ok && sameEndpoint(u, upstream) {
				iface["url"] = proxy
				kept = append(kept, iface)
			}
		}
		card[key] = kept
	}
}

// sameEndpoint reports whether u names the upstream endpoint itself.
func sameEndpoint(u, upstream string) bool {
	return strings.TrimSuffix(u, "/") == strings.TrimSuffix(upstream, "/")
}

// rewriteReplyCard rewrites the card in an extended Agent Card reply, bare
// (HTTP+JSON) or as a JSON-RPC result. A reply it cannot read is unchanged.
func rewriteReplyCard(body []byte, upstream, proxy string) []byte {
	var reply map[string]any
	if json.Unmarshal(body, &reply) != nil {
		return body
	}
	card := reply
	if result, ok := reply["result"].(map[string]any); ok {
		card = result
	}
	rewriteCard(card, upstream, proxy)
	out, err := json.Marshal(reply)
	if err != nil {
		return body
	}
	return out
}

func proxyBase(public string, r *http.Request, target string) string {
	if public != "" {
		return strings.TrimSuffix(public, "/") + strings.TrimSuffix(PathPrefix, "/") + "/" + target
	}
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
