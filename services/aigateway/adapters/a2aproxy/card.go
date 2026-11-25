package a2aproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// serveCard fetches the target's Agent Card and points every interface URL
// at the gateway, so a client that reads the card keeps calling through it.
func (h *Handler) serveCard(c *call, target domain.A2ATarget) {
	card, raw, ok := h.fetchCard(c, target)
	if !ok || !h.scan(c, DirectionResponse, raw) {
		return
	}
	if target.AgentName == "" {
		if name, isName := card["name"].(string); isName && name != "" {
			c.span.SetAttributes(attribute.String(attrAgentName, name))
		}
	}
	rewriteCard(card, target.UpstreamURL, proxyBase(h.cfg.PublicBaseURL, target.Name))
	out, _ := json.Marshal(card)
	setJSONReply(c.w.Header())
	c.w.WriteHeader(http.StatusOK)
	_, _ = c.w.Write(out)
}

// fetchCard reads the upstream Agent Card, parsed and raw, refusing the call
// when it cannot. Without a card URL it reads the discovery path the caller
// asked for. The target's upstream headers go only to a card on the
// upstream's own origin: a card elsewhere is fetched without them.
func (h *Handler) fetchCard(c *call, target domain.A2ATarget) (map[string]any, []byte, bool) {
	cardURL := target.CardURL
	if cardURL == "" {
		cardURL = upstreamEndpoint(target.UpstreamURL, c.cardPath, "")
	}
	ctx, cancel := context.WithCancel(c.ctx)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cardURL, nil)
	if err != nil {
		c.refuse(refuseUpstream.withMessage("the Agent Card URL is invalid"))
		return nil, nil, false
	}
	if sameOrigin(target.UpstreamURL, cardURL) {
		for k, v := range target.UpstreamHeaders {
			req.Header.Set(k, v)
		}
	}
	propagation.TraceContext{}.Inject(c.ctx, propagation.HeaderCarrier(req.Header))
	resp, err := h.cfg.Client.Do(req)
	if err != nil {
		h.refuseUpstreamFailure(c, err)
		return nil, nil, false
	}
	defer func() { _ = resp.Body.Close() }()
	raw, tooLarge, err := h.readReply(resp.Body, cancel)
	if tooLarge {
		c.refuse(refuseReplyTooLarge)
		return nil, nil, false
	}
	if err != nil {
		h.refuseWithCause(c, refuseUpstream.withMessage("the A2A agent reply was cut off"), err)
		return nil, nil, false
	}
	card, isCard := decodeObject(raw)
	if resp.StatusCode != http.StatusOK || !isCard {
		c.refuse(refuseUpstream.withMessage("the A2A agent has no readable Agent Card"))
		return nil, nil, false
	}
	return card, raw, true
}

// decodeObject reads a body that is exactly one JSON object. Numbers keep the
// digits they were written with, so an id or extension value survives a
// rewrite. JSON null, another value and trailing input are no object.
func decodeObject(raw []byte) (map[string]any, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var obj map[string]any
	if dec.Decode(&obj) != nil || obj == nil {
		return nil, false
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, false
	}
	return obj, true
}

// rewriteCard points the card at the proxy. The proxy serves one endpoint per
// target, the upstream URL, so the card's url becomes the proxy base, an
// interface at the upstream URL does too, and every other interface (another
// path or host the proxy does not serve) is dropped. The upstream's signatures
// signed the URLs replaced here, so they go too: they would no longer verify.
func rewriteCard(card map[string]any, upstream, proxy string) {
	card["url"] = proxy
	delete(card, "signatures")
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

// sameOrigin reports whether two absolute URLs share scheme, host and port,
// the port defaulting by scheme.
func sameOrigin(a, b string) bool {
	ua, errA := url.Parse(a)
	ub, errB := url.Parse(b)
	if errA != nil || errB != nil || ua.Host == "" || ub.Host == "" {
		return false
	}
	return strings.EqualFold(ua.Scheme, ub.Scheme) &&
		strings.EqualFold(ua.Hostname(), ub.Hostname()) && originPort(ua) == originPort(ub)
}

func originPort(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	if strings.EqualFold(u.Scheme, "https") {
		return "443"
	}
	return "80"
}

// isHTTPS reports whether a target URL is https.
func isHTTPS(raw string) bool {
	return strings.HasPrefix(strings.ToLower(raw), "https://")
}

// sameEndpoint reports whether u names the upstream endpoint itself: the same
// origin, path (a trailing slash aside) and query.
func sameEndpoint(u, upstream string) bool {
	a, errA := url.Parse(u)
	b, errB := url.Parse(upstream)
	if errA != nil || errB != nil || !sameOrigin(u, upstream) {
		return false
	}
	return strings.TrimSuffix(a.EscapedPath(), "/") == strings.TrimSuffix(b.EscapedPath(), "/") &&
		a.RawQuery == b.RawQuery
}

// rewriteReplyCard rewrites the card in an extended Agent Card reply, bare
// (HTTP+JSON) or as a JSON-RPC result. An error reply, or one it cannot read,
// is unchanged.
func rewriteReplyCard(body []byte, upstream, proxy string) []byte {
	reply, ok := decodeObject(body)
	if !ok {
		return body
	}
	card, ok := replyCard(reply)
	if !ok {
		return body
	}
	rewriteCard(card, upstream, proxy)
	out, err := json.Marshal(reply)
	if err != nil {
		return body
	}
	return out
}

// replyCard finds the Agent Card in a reply: an object result, or a bare body
// that is no JSON-RPC or error envelope. An error reply carries no card.
func replyCard(reply map[string]any) (map[string]any, bool) {
	if result, ok := reply["result"].(map[string]any); ok {
		return result, true
	}
	for _, key := range []string{"result", "error", "jsonrpc"} {
		if _, found := reply[key]; found {
			return nil, false
		}
	}
	return reply, true
}

// proxyBase is the target's endpoint on the gateway's configured public origin.
func proxyBase(public, target string) string {
	return strings.TrimSuffix(public, "/") + strings.TrimSuffix(PathPrefix, "/") + "/" + target
}
