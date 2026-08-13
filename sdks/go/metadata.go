package langwatch

import (
	"fmt"
	"strings"

	"go.opentelemetry.io/otel/attribute"
)

// Metadata builds a custom trace-metadata attribute. The key is namespaced under
// "metadata." so the server hoists it to trace-level metadata. For non-string
// values, use the typed attribute.* constructors (attribute.Int, attribute.Bool,
// …) directly and pass them to SetTraceMetadata, which namespaces bare keys.
func Metadata(key, value string) attribute.KeyValue {
	return attribute.String(metadataKey(key), value)
}

// Origin builds the metadata.origin attribute identifying where a trace came
// from (e.g. "api", "chat-widget", "cron-job").
func Origin(value string) attribute.KeyValue { return Metadata("origin", value) }

// Environment builds the metadata.environment attribute (e.g. "production").
func Environment(value string) attribute.KeyValue { return Metadata("environment", value) }

// AppVersion builds the metadata.version attribute for your application version.
func AppVersion(value string) attribute.KeyValue { return Metadata("version", value) }

// metadataKey namespaces a bare key under MetadataPrefix, leaving an
// already-namespaced key untouched (so the alias helpers can be passed straight
// to SetTraceMetadata without double-prefixing).
func metadataKey(key string) string {
	if strings.HasPrefix(key, MetadataPrefix) {
		return key
	}
	return MetadataPrefix + key
}

// SetTraceMetadata records custom trace-level metadata as individual, hoistable
// metadata.<key> attributes (not a JSON blob). Each attribute's key is namespaced
// under "metadata." unless already namespaced — so you can pass plain OTel
// attributes or the langwatch.Metadata/Origin/… alias helpers interchangeably:
//
//	span.SetTraceMetadata(
//	    langwatch.Origin("api"),
//	    attribute.String("feature", "checkout"),
//	    attribute.Int("attempt", 2),
//	)
//
// Setting the same key again overrides it on this span; across spans the server
// merges per key. Reserved identity (user, conversation/thread, customer,
// labels) has dedicated setters — prefer those over metadata.
func (s *Span) SetTraceMetadata(attrs ...attribute.KeyValue) *Span {
	if len(attrs) == 0 {
		return s
	}
	out := make([]attribute.KeyValue, len(attrs))
	for i, a := range attrs {
		a.Key = attribute.Key(metadataKey(string(a.Key)))
		out[i] = a
	}
	s.SetAttributes(out...)
	return s
}

// SetTraceMetadataMap is the bulk convenience for SetTraceMetadata. Values are
// recorded with their natural OTel attribute type where possible, otherwise
// stringified.
func (s *Span) SetTraceMetadataMap(metadata map[string]any) *Span {
	if len(metadata) == 0 {
		return s
	}
	attrs := make([]attribute.KeyValue, 0, len(metadata))
	for k, v := range metadata {
		attrs = append(attrs, metadataAttr(k, v))
	}
	return s.SetTraceMetadata(attrs...)
}

// SetOrigin records where the trace originated (metadata.origin).
func (s *Span) SetOrigin(origin string) *Span {
	return s.SetTraceMetadata(Origin(origin))
}

// metadataAttr builds a namespaced attribute for an arbitrary value, choosing
// the natural OTel attribute type for common Go types.
func metadataAttr(key string, value any) attribute.KeyValue {
	k := metadataKey(key)
	switch v := value.(type) {
	case string:
		return attribute.String(k, v)
	case bool:
		return attribute.Bool(k, v)
	case int:
		return attribute.Int(k, v)
	case int64:
		return attribute.Int64(k, v)
	case float64:
		return attribute.Float64(k, v)
	case []string:
		return attribute.StringSlice(k, v)
	default:
		return attribute.String(k, fmt.Sprintf("%v", value))
	}
}
