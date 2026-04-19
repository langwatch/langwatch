// Package cacheoverride implements the `X-LangWatch-Cache` request
// header per contract §7 — a per-request knob that lets callers
// override the VK's default cache_control passthrough behaviour.
//
// Supported modes:
//
//   - respect (default): pass the caller's `cache_control` fields
//     through byte-for-byte. No-op.
//   - disable: strip every `cache_control` object from the body before
//     forwarding. Lets customers validate cold-cache baselines and
//     chase cache-dependent bugs.
//   - force: NOT IMPLEMENTED v1 — requires provider-specific body
//     mutation (Anthropic expects `cache_control` on specific message
//     positions). Deferred to v1.1 alongside the caching-strategy
//     surface.
//   - ttl=N: NOT IMPLEMENTED v1 — Anthropic doesn't accept explicit
//     TTL today; modelling this requires either a roadmap bump or
//     edge-cache at the gateway. Deferred to v1.1.
//
// Unknown / malformed modes return `cache_override_invalid` (400).
package cacheoverride

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Mode is the parsed header value.
type Mode struct {
	Kind    Kind
	TTLSecs int // set only when Kind == KindTTL
}

// Kind enumerates the header's known modes.
type Kind string

const (
	KindRespect Kind = "respect"
	KindDisable Kind = "disable"
	KindForce   Kind = "force"
	KindTTL     Kind = "ttl"
)

// ErrInvalid is returned for malformed / unknown header values. The
// caller maps this to a 400 cache_override_invalid envelope.
var ErrInvalid = errors.New("invalid X-LangWatch-Cache value")

// ErrNotImplemented signals a valid-but-deferred mode. The dispatcher
// surfaces it as 400 so the caller learns upfront rather than getting
// silently "respect" behaviour.
var ErrNotImplemented = errors.New("cache override mode not implemented in v1")

// Parse turns a header value into a Mode. Empty string = respect.
// Whitespace-trimmed, case-insensitive.
func Parse(hdr string) (Mode, error) {
	s := strings.TrimSpace(strings.ToLower(hdr))
	if s == "" {
		return Mode{Kind: KindRespect}, nil
	}
	switch s {
	case "respect":
		return Mode{Kind: KindRespect}, nil
	case "disable":
		return Mode{Kind: KindDisable}, nil
	case "force":
		return Mode{Kind: KindForce}, ErrNotImplemented
	}
	if strings.HasPrefix(s, "ttl=") {
		v, err := strconv.Atoi(s[len("ttl="):])
		if err != nil || v <= 0 {
			return Mode{}, fmt.Errorf("%w: ttl must be positive integer seconds", ErrInvalid)
		}
		return Mode{Kind: KindTTL, TTLSecs: v}, ErrNotImplemented
	}
	return Mode{}, fmt.Errorf("%w: %q", ErrInvalid, hdr)
}

// Apply mutates the body according to the mode. Returns the possibly-
// rewritten body; never nil on success (callers can compare pointers
// cheaply to detect whether a mutation happened). On respect, returns
// the input unchanged.
func Apply(mode Mode, body []byte) ([]byte, error) {
	if mode.Kind == KindRespect || len(body) == 0 {
		return body, nil
	}
	if mode.Kind != KindDisable {
		return nil, ErrNotImplemented
	}
	return stripCacheControl(body)
}

// stripCacheControl walks a generic-JSON payload and drops every
// `cache_control` key regardless of nesting depth. Works for both
// Anthropic's `messages[].content[].cache_control` and the newer
// `system` / `tools` fields that also carry it. Re-encoding
// preserves field order well enough for the downstream provider —
// the JSON spec doesn't guarantee order and Anthropic accepts either.
func stripCacheControl(body []byte) ([]byte, error) {
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		return nil, fmt.Errorf("cache_override: body not JSON: %w", err)
	}
	walk(v)
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	out := buf.Bytes()
	// json.Encoder appends a trailing newline; Anthropic is fine with
	// it, but trim for byte-equivalence with the non-overridden path.
	if n := len(out); n > 0 && out[n-1] == '\n' {
		out = out[:n-1]
	}
	return out, nil
}

// walk recursively drops `cache_control` keys from every map it
// encounters. Mutates in place; safe on the `any` tree from
// json.Unmarshal.
func walk(v any) {
	switch t := v.(type) {
	case map[string]any:
		delete(t, "cache_control")
		for _, child := range t {
			walk(child)
		}
	case []any:
		for _, child := range t {
			walk(child)
		}
	}
}
