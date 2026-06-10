// Package prompts emits the PromptApiService.get + Prompt.compile span
// pair that the trace-UI consumer (langwatch/src/server/traces/
// findPromptReferenceInAncestors.ts) walks to surface "Open in Prompts"
// deep-links on LLM spans.
//
// The shape mirrors python-sdk byte-for-byte:
//
//   - PromptApiService.get
//       langwatch.prompt.variables = JSON {"type":"json","value":{"prompt_id":"<id>"[,"tag":"<tag>"]}}
//       langwatch.prompt.id        = "<handle>:<version>"  (only when both resolved)
//
//   - Prompt.compile
//       langwatch.prompt.id            = <id>           (optional)
//       langwatch.prompt.handle        = <handle>       (optional)
//       langwatch.prompt.version.id    = <version_id>   (optional)
//       langwatch.prompt.version.number= <version_num>  (optional)
//       langwatch.prompt.variables     = JSON {"type":"json","value":{...vars}}
//       langwatch.prompt.draft         = true           (only when applied unsaved)
//
// Reference: python-sdk/src/langwatch/prompts/decorators/{prompt_service_tracing,prompt_tracing}.py.
package prompts

import (
	"context"
	"encoding/json"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
)

// tracerName mirrors python's `trace.get_tracer(__name__)` — gives this
// package its own tracer so spans are attributable to the SDK rather
// than the calling engine.
const tracerName = "github.com/langwatch/langwatch/sdk-go/prompts"

// GetSpec carries the identity of a prompt resolution event for the
// PromptApiService.get span. PromptID is the input variable; Handle +
// VersionNumber are the resolved identity (populate post-fetch) and
// trigger the combined "<handle>:<version>" id stamp when both are set.
type GetSpec struct {
	// PromptID is the input handle-or-id used to resolve the prompt
	// (whatever the caller passed to the fetch). Recorded under
	// `variables.value.prompt_id`.
	PromptID string
	// Tag is an optional version-tag filter ("production", "staging",
	// or a custom name). Recorded under `variables.value.tag` when set.
	Tag string
	// Handle is the resolved canonical handle (e.g. "pizza-prompt").
	// Combined with VersionNumber it becomes the `langwatch.prompt.id`
	// stamp on the get span.
	Handle string
	// VersionNumber is the resolved version (1-indexed). Combined with
	// Handle as above. Zero means unresolved — the combined id is then
	// omitted to mirror python's "emit nothing when either is missing".
	VersionNumber int
}

// EmitGet records a PromptApiService.get span synchronously. Intended
// for callers that already have the resolved prompt (e.g. the nlpgo
// engine, which loads prompts inline from the workflow DSL) and just
// need to emit the telemetry envelope the trace UI expects.
//
// Mirrors python prompt_service_tracing.PromptServiceTracing.get —
// minus the function-wrap, since the Go engine doesn't fetch through
// this helper.
func EmitGet(ctx context.Context, spec GetSpec) {
	tracer := otel.Tracer(tracerName)
	_, span := tracer.Start(ctx, "PromptApiService.get")
	defer span.End()

	// Input variables (the kwargs passed to PromptApiService.get on the
	// python side: prompt_id + optional tag).
	input := map[string]any{"prompt_id": spec.PromptID}
	if spec.Tag != "" {
		input["tag"] = spec.Tag
	}
	if encoded, ok := encodeVariablesJSON(input); ok {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptVariables).String(encoded))
	}

	// Combined identity is stamped ONLY when both handle and version
	// resolved — matches python's two-field-or-nothing guard.
	if spec.Handle != "" && spec.VersionNumber > 0 {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptID).String(combinedID(spec.Handle, spec.VersionNumber)))
	}
}

// CompileSpec carries the identity stamped on a Prompt.compile span
// plus the variables that drove the template render. All identity
// fields are optional; omitted ones are skipped on the span (mirrors
// python's `_set_attribute_if_not_none`).
type CompileSpec struct {
	// PromptID is the raw prompt id (e.g. "prompt_4RXLJtB9Cj-OA1BaLpxWc")
	// — NOT the combined "<handle>:<version>" form (that one lives on
	// the get span). On Prompt.compile this is the standalone id only.
	PromptID string
	// Handle is the canonical handle (e.g. "pizza-prompt").
	Handle string
	// VersionID is the version row id (e.g.
	// "prompt_version_I21kDsHKtr5wQm9k1Dap2").
	VersionID string
	// VersionNumber is the integer version (1-indexed); 0 means unset.
	VersionNumber int
	// Variables is the inputs map that drove the template render.
	// Encoded as `{"type":"json","value":<vars>}` on the span. Keys whose
	// values fail to marshal are dropped (best-effort, per the spec —
	// "non-serializable values are stringified, dispatch still succeeds").
	Variables map[string]any
	// Draft, when true, signals the executed config diverges from the
	// saved version named by Handle/VersionNumber. Omitted entirely
	// when false (matches python's _set_attribute_if_not_none convention
	// — UI consumers treat absent == false; explicit false would just
	// be noise).
	Draft bool
}

// EmitCompile records a Prompt.compile span synchronously. Like
// EmitGet, intended for the nlpgo engine path where the template
// render happens outside this helper but the telemetry envelope must
// still reflect python-sdk's @prompt_tracing.compile decorator output.
//
// Mirrors python prompt_tracing.PromptTracing.compile — minus the
// function-wrap, exception recording, and span-as-context-active. The
// engine's per-node component span is the current span when this fires,
// so Prompt.compile is correctly parented as a sibling of the LLM span
// the engine emits next.
func EmitCompile(ctx context.Context, spec CompileSpec) {
	tracer := otel.Tracer(tracerName)
	_, span := tracer.Start(ctx, "Prompt.compile")
	defer span.End()

	if spec.PromptID != "" {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptID).String(spec.PromptID))
	}
	if spec.Handle != "" {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptHandle).String(spec.Handle))
	}
	if spec.VersionID != "" {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptVersionID).String(spec.VersionID))
	}
	if spec.VersionNumber > 0 {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptVersionNumber).Int(spec.VersionNumber))
	}
	if encoded, ok := encodeVariablesJSON(spec.Variables); ok {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptVariables).String(encoded))
	}
	if spec.Draft {
		span.SetAttributes(attribute.Key(langwatch.AttributeLangWatchPromptDraft).Bool(true))
	}
}

// combinedID produces the "<handle>:<version>" stamp the trace UI uses
// to label the "Open in Prompts" deep-link. Mirrors python's
// `f"{result.handle}:{result.version}"`.
func combinedID(handle string, version int) string {
	return handle + ":" + itoa(version)
}

// itoa is strconv.Itoa avoiding an import — keeps the package's
// import set minimal.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	negative := n < 0
	if negative {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// encodeVariablesJSON marshals vars into the `{"type":"json","value":...}`
// envelope the trace UI expects. Returns (encoded, true) on success and
// ("", false) when no usable subset can be marshaled.
//
// Best-effort semantics: keys whose individual values fail json.Marshal
// are dropped, preserving the rest. Matches the spec wording
// "variables capture is best-effort — non-JSON-serializable values are
// stringified, the dispatch still succeeds".
func encodeVariablesJSON(vars map[string]any) (string, bool) {
	value := serializableSubset(vars)
	encoded, err := json.Marshal(map[string]any{
		"type":  "json",
		"value": value,
	})
	if err != nil {
		return "", false
	}
	return string(encoded), true
}

// serializableSubset returns a copy of vars containing only entries
// whose values successfully round-trip through json.Marshal. nil maps
// produce an empty map (not nil) so the resulting JSON is
// `"value":{}` rather than `"value":null` — matches python where an
// empty kwargs call records `{}` on the span.
func serializableSubset(vars map[string]any) map[string]any {
	out := make(map[string]any, len(vars))
	for k, v := range vars {
		if _, err := json.Marshal(v); err == nil {
			out[k] = v
		}
	}
	return out
}
