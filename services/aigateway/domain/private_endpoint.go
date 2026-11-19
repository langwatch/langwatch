package domain

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strings"
)

// PrivateEndpointsHeader carries an organization's private endpoint bindings
// on the app's internal call to nlpgo's playground proxy: base64url (no
// padding) of the same JSON array the workflow payload and the gateway config
// carry. See ADR-203.
const PrivateEndpointsHeader = "X-LangWatch-Private-Endpoints"

// PrivateEndpoint is one hostname an organization bound to a private endpoint
// staff registered for it (ADR-203). A model call whose base URL host equals
// Hostname never resolves that name: it dials one of Addresses, in order, on
// Port, and keeps Hostname for TLS SNI, certificate verification and the Host
// header.
//
// Addresses are owned by staff, never by the customer, and are opaque to the
// caller: no error built from a PrivateEndpoint may name them.
type PrivateEndpoint struct {
	Hostname  string
	Addresses []netip.Addr
	Port      int
}

// privateEndpointWire is the fixed wire shape shared with the TS app:
// [{"hostname":"llm.internal.acme.test","addresses":["10.20.1.21"],"port":443}].
type privateEndpointWire struct {
	Hostname  string   `json:"hostname"`
	Addresses []string `json:"addresses"`
	Port      int      `json:"port"`
}

// ErrPrivateEndpointsMalformed is returned for bindings that do not decode.
// The caller refuses the whole request: silently dropping a malformed list
// would send a bound hostname through DNS, the one thing a binding forbids.
var ErrPrivateEndpointsMalformed = errors.New("private endpoint bindings are malformed")

// ParsePrivateEndpoints decodes the JSON array of bindings. Absent (empty
// input or JSON null) and an empty array both mean "no bindings", which is
// today's behaviour. Every entry must be well formed; the errors name the
// field and the entry index, never an address value.
func ParsePrivateEndpoints(raw []byte) ([]PrivateEndpoint, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return nil, nil
	}
	var wire []privateEndpointWire
	if err := json.Unmarshal([]byte(trimmed), &wire); err != nil {
		return nil, fmt.Errorf("%w: not a JSON array of bindings", ErrPrivateEndpointsMalformed)
	}
	if len(wire) == 0 {
		return nil, nil
	}
	out := make([]PrivateEndpoint, 0, len(wire))
	seen := make(map[string]struct{}, len(wire))
	for i, w := range wire {
		ep, err := w.toDomain()
		if err != nil {
			return nil, fmt.Errorf("%w: entry %d: %s", ErrPrivateEndpointsMalformed, i, err.Error())
		}
		if _, dup := seen[ep.Hostname]; dup {
			return nil, fmt.Errorf("%w: entry %d: hostname %q is bound twice", ErrPrivateEndpointsMalformed, i, ep.Hostname)
		}
		seen[ep.Hostname] = struct{}{}
		out = append(out, ep)
	}
	return out, nil
}

func (w privateEndpointWire) toDomain() (PrivateEndpoint, error) {
	host := NormalizeEndpointHost(w.Hostname)
	if err := validateBindingHostname(host); err != nil {
		return PrivateEndpoint{}, err
	}
	if w.Port < 1 || w.Port > 65535 {
		return PrivateEndpoint{}, errors.New("port must be between 1 and 65535")
	}
	if len(w.Addresses) == 0 {
		return PrivateEndpoint{}, errors.New("addresses must not be empty")
	}
	addrs := make([]netip.Addr, 0, len(w.Addresses))
	for _, raw := range w.Addresses {
		addr, err := netip.ParseAddr(strings.TrimSpace(raw))
		if err != nil || addr.Zone() != "" {
			// The value itself is left out on purpose: it is a staff-owned
			// address and this text can reach a tenant.
			return PrivateEndpoint{}, errors.New("addresses must be plain IP addresses")
		}
		addrs = append(addrs, addr.Unmap())
	}
	return PrivateEndpoint{Hostname: host, Addresses: addrs, Port: w.Port}, nil
}

// validateBindingHostname refuses what can never be a bound name: an IP
// literal (ADR-203: an IP-literal base URL is never bound), a wildcard, or
// anything that is not a plain DNS name.
func validateBindingHostname(host string) error {
	if host == "" {
		return errors.New("hostname must not be empty")
	}
	if _, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		return errors.New("hostname must be a DNS name, not an IP address")
	}
	if len(host) > 253 {
		return errors.New("hostname is too long")
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 {
			return errors.New("hostname must be a DNS name")
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return errors.New("hostname must be a DNS name")
			}
		}
	}
	return nil
}

// DecodePrivateEndpointsHeader decodes the X-LangWatch-Private-Endpoints
// header value: base64url without padding of the JSON array. An empty value
// means no bindings.
func DecodePrivateEndpointsHeader(value string) ([]PrivateEndpoint, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("%w: header is not base64url without padding", ErrPrivateEndpointsMalformed)
	}
	return ParsePrivateEndpoints(raw)
}

// EncodePrivateEndpointsHeader is the inverse of DecodePrivateEndpointsHeader.
// The TS app owns the production encoder; this exists for tests and tools.
func EncodePrivateEndpointsHeader(eps []PrivateEndpoint) string {
	wire := make([]privateEndpointWire, 0, len(eps))
	for _, ep := range eps {
		addrs := make([]string, 0, len(ep.Addresses))
		for _, a := range ep.Addresses {
			addrs = append(addrs, a.String())
		}
		wire = append(wire, privateEndpointWire{Hostname: ep.Hostname, Addresses: addrs, Port: ep.Port})
	}
	raw, _ := json.Marshal(wire)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// NormalizeEndpointHost lowercases a host and drops a trailing dot, the form
// bindings are stored and compared in.
func NormalizeEndpointHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}

// PrivateEndpointFor returns the binding for host, if the organization bound
// it. An IP literal is never bound, whatever the list holds.
func PrivateEndpointFor(eps []PrivateEndpoint, host string) (PrivateEndpoint, bool) {
	if len(eps) == 0 {
		return PrivateEndpoint{}, false
	}
	host = NormalizeEndpointHost(host)
	if _, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil || host == "" {
		return PrivateEndpoint{}, false
	}
	for _, ep := range eps {
		if ep.Hostname == host {
			return ep, true
		}
	}
	return PrivateEndpoint{}, false
}

// Identity is a stable string naming everything that decides where a call to
// this binding goes. Used to key per-binding clients and providers; it holds
// the addresses, so it is never logged or returned.
func (ep PrivateEndpoint) Identity() string {
	var b strings.Builder
	b.WriteString(ep.Hostname)
	fmt.Fprintf(&b, "|%d|", ep.Port)
	for _, a := range ep.Addresses {
		b.WriteString(a.String())
		b.WriteByte(',')
	}
	return b.String()
}

type privateEndpointsCtxKey struct{}

// WithPrivateEndpoints carries the calling organization's bindings on ctx, for
// callers (nlpgo's workflow engine) that build credentials far from where the
// bindings arrived. Credential.PrivateEndpoints is the field dispatch reads.
func WithPrivateEndpoints(ctx context.Context, eps []PrivateEndpoint) context.Context {
	if len(eps) == 0 {
		return ctx
	}
	return context.WithValue(ctx, privateEndpointsCtxKey{}, eps)
}

// PrivateEndpointsFromContext returns the bindings WithPrivateEndpoints put on
// ctx, or nil.
func PrivateEndpointsFromContext(ctx context.Context) []PrivateEndpoint {
	eps, _ := ctx.Value(privateEndpointsCtxKey{}).([]PrivateEndpoint)
	return eps
}
