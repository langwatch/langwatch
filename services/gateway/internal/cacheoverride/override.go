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
//   - force: Anthropic-shape bodies get `cache_control: ephemeral`
//     injected on the last system block + last user content block
//     (per spec §3). Client-set cache_control is preserved — no
//     double injection. OpenAI-shape bodies (string content) are a
//     no-op because their caching is automatic. Gemini body-shapes
//     are not yet supported (needs /cachedContents pre-POST; v1.1).
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
		// Body-injection for Anthropic-shape bodies; no-op for
		// OpenAI-shape (their caching is automatic).
		return Mode{Kind: KindForce}, nil
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
	switch mode.Kind {
	case KindDisable:
		return stripCacheControl(body)
	case KindForce:
		return injectCacheControl(body)
	case KindTTL:
		return nil, ErrNotImplemented
	}
	return nil, ErrNotImplemented
}

// injectCacheControl walks an Anthropic-shape body and adds
// cache_control: {type: "ephemeral"} on the last system block +
// last message content block per spec §3. Returns the body unchanged
// for bodies that don't look like Anthropic shape (no `messages`
// or string-content messages) — OpenAI caching is automatic, so
// force on OpenAI is a documented no-op.
//
// Client-set cache_control anywhere on the target block short-circuits
// the inject — we preserve what the client already sent.
func injectCacheControl(body []byte) ([]byte, error) {
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		return nil, fmt.Errorf("cache_override: body not JSON: %w", err)
	}
	root, ok := v.(map[string]any)
	if !ok {
		return body, nil
	}

	changed := false
	// system[-1]: last block of system array, if system is an array
	// of blocks (Anthropic-shape). String-only systems are OpenAI/
	// legacy Anthropic and skipped.
	if sys, ok := root["system"].([]any); ok && len(sys) > 0 {
		if ensureEphemeral(sys[len(sys)-1]) {
			changed = true
		}
	}
	// messages[-1].content[-1]: last content block of the last message,
	// when content is an array (structured Anthropic/OpenAI-multimodal
	// shape). String content is skipped — injection isn't possible
	// without promoting the shape, which would be a visible breaking
	// change for the caller.
	if msgs, ok := root["messages"].([]any); ok && len(msgs) > 0 {
		lastMsg, ok := msgs[len(msgs)-1].(map[string]any)
		if ok {
			if content, ok := lastMsg["content"].([]any); ok && len(content) > 0 {
				if ensureEphemeral(content[len(content)-1]) {
					changed = true
				}
			}
		}
	}

	if !changed {
		return body, nil
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	out := buf.Bytes()
	if n := len(out); n > 0 && out[n-1] == '\n' {
		out = out[:n-1]
	}
	return out, nil
}

// ensureEphemeral adds cache_control: {type: "ephemeral"} to the
// given block if it's a map and doesn't already have cache_control.
// Returns true when a mutation happened.
func ensureEphemeral(block any) bool {
	m, ok := block.(map[string]any)
	if !ok {
		return false
	}
	if _, present := m["cache_control"]; present {
		return false
	}
	m["cache_control"] = map[string]any{"type": "ephemeral"}
	return true
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
