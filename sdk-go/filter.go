package langwatch

import (
	"regexp"
	"strings"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// Filter represents a span filtering rule that can be applied to a slice of spans.
type Filter interface {
	// Apply filters the given spans and returns only the spans that pass the filter.
	Apply(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan
}

// FilterFunc is a function type that implements the Filter interface.
type FilterFunc func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan

// Apply implements the Filter interface.
func (f FilterFunc) Apply(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
	return f(spans)
}

// Matcher defines how to match a string value.
type Matcher struct {
	Equals     string
	StartsWith string
	Regex      *regexp.Regexp
	IgnoreCase bool
}

// Matches returns true if the matcher matches the given value.
func (m Matcher) Matches(value string) bool {
	checkValue := value
	checkEquals := m.Equals
	checkStartsWith := m.StartsWith

	if m.IgnoreCase {
		checkValue = strings.ToLower(value)
		checkEquals = strings.ToLower(m.Equals)
		checkStartsWith = strings.ToLower(m.StartsWith)
	}

	if checkEquals != "" {
		return checkValue == checkEquals
	}

	if checkStartsWith != "" {
		return strings.HasPrefix(checkValue, checkStartsWith)
	}

	if m.Regex != nil {
		return m.Regex.MatchString(value)
	}

	return false
}

// Equals creates a matcher that matches an exact string value.
func Equals(s string) Matcher {
	return Matcher{Equals: s}
}

// EqualsIgnoreCase creates a matcher that matches a string value case-insensitively.
func EqualsIgnoreCase(s string) Matcher {
	return Matcher{Equals: s, IgnoreCase: true}
}

// StartsWith creates a matcher that matches strings starting with the given prefix.
func StartsWith(prefix string) Matcher {
	return Matcher{StartsWith: prefix}
}

// StartsWithIgnoreCase creates a matcher that matches strings starting with the given prefix, case-insensitively.
func StartsWithIgnoreCase(prefix string) Matcher {
	return Matcher{StartsWith: prefix, IgnoreCase: true}
}

// MatchRegex creates a matcher that matches strings against the given regular expression.
func MatchRegex(re *regexp.Regexp) Matcher {
	return Matcher{Regex: re}
}

// MustMatchRegex creates a matcher that matches strings against the given pattern.
// Panics if the pattern is invalid.
func MustMatchRegex(pattern string) Matcher {
	return Matcher{Regex: regexp.MustCompile(pattern)}
}

// Criteria defines the conditions for matching spans.
// Multiple fields use AND semantics (all specified fields must match).
// Multiple matchers within a field use OR semantics (any matcher can match).
type Criteria struct {
	// ScopeName matches against the span's InstrumentationScope.Name
	ScopeName []Matcher
	// SpanName matches against the span's Name
	SpanName []Matcher
}

// Matches returns true if the span matches all specified criteria.
// Empty criteria matches all spans.
func (c Criteria) Matches(span sdktrace.ReadOnlySpan) bool {
	// Check ScopeName (OR semantics within matchers)
	if len(c.ScopeName) > 0 {
		scopeName := span.InstrumentationScope().Name
		matched := false
		for _, m := range c.ScopeName {
			if m.Matches(scopeName) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	// Check SpanName (OR semantics within matchers)
	if len(c.SpanName) > 0 {
		spanName := span.Name()
		matched := false
		for _, m := range c.SpanName {
			if m.Matches(spanName) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	return true
}

// Include creates a filter that keeps only spans matching the criteria.
func Include(criteria Criteria) Filter {
	return FilterFunc(func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
		result := make([]sdktrace.ReadOnlySpan, 0, len(spans))
		for _, span := range spans {
			if criteria.Matches(span) {
				result = append(result, span)
			}
		}
		return result
	})
}

// Exclude creates a filter that removes spans matching the criteria.
func Exclude(criteria Criteria) Filter {
	return FilterFunc(func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
		result := make([]sdktrace.ReadOnlySpan, 0, len(spans))
		for _, span := range spans {
			if !criteria.Matches(span) {
				result = append(result, span)
			}
		}
		return result
	})
}

// httpVerbRegex matches HTTP request span names (e.g., "GET /api/users", "POST /data")
var httpVerbRegex = regexp.MustCompile(`(?i)^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b`)

// ExcludeHTTPRequests creates a filter that removes HTTP request spans.
// This matches spans whose names start with HTTP verbs (GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD).
func ExcludeHTTPRequests() Filter {
	return FilterFunc(func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
		result := make([]sdktrace.ReadOnlySpan, 0, len(spans))
		for _, span := range spans {
			if !httpVerbRegex.MatchString(span.Name()) {
				result = append(result, span)
			}
		}
		return result
	})
}

// LangWatchOnly creates a filter that keeps only spans from LangWatch instrumentation.
// This matches spans whose scope name starts with "github.com/langwatch/" or "langwatch".
func LangWatchOnly() Filter {
	return FilterFunc(func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
		result := make([]sdktrace.ReadOnlySpan, 0, len(spans))
		for _, span := range spans {
			scopeName := span.InstrumentationScope().Name
			if strings.HasPrefix(scopeName, "github.com/langwatch/") || strings.HasPrefix(scopeName, "langwatch") {
				result = append(result, span)
			}
		}
		return result
	})
}

// applyFilters applies multiple filters in sequence (AND semantics).
func applyFilters(spans []sdktrace.ReadOnlySpan, filters []Filter) []sdktrace.ReadOnlySpan {
	result := spans
	for _, f := range filters {
		result = f.Apply(result)
		if len(result) == 0 {
			return result
		}
	}
	return result
}
