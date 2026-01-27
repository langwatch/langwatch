package langwatch

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// mockSpan creates a mock ReadOnlySpan for testing using tracetest.SpanStub.
func mockSpan(name string, scopeName string) sdktrace.ReadOnlySpan {
	stub := tracetest.SpanStub{
		Name:                 name,
		InstrumentationScope: instrumentation.Scope{Name: scopeName},
	}
	return stub.Snapshot()
}

func TestMatcher_Equals(t *testing.T) {
	m := Equals("hello")

	assert.True(t, m.Matches("hello"))
	assert.False(t, m.Matches("Hello"))
	assert.False(t, m.Matches("hello world"))
	assert.False(t, m.Matches(""))
}

func TestMatcher_EqualsIgnoreCase(t *testing.T) {
	m := EqualsIgnoreCase("Hello")

	assert.True(t, m.Matches("hello"))
	assert.True(t, m.Matches("Hello"))
	assert.True(t, m.Matches("HELLO"))
	assert.False(t, m.Matches("hello world"))
}

func TestMatcher_StartsWith(t *testing.T) {
	m := StartsWith("github.com/langwatch/")

	assert.True(t, m.Matches("github.com/langwatch/sdk-go"))
	assert.True(t, m.Matches("github.com/langwatch/"))
	assert.False(t, m.Matches("github.com/other/"))
	assert.False(t, m.Matches("GitHub.com/langwatch/"))
}

func TestMatcher_StartsWithIgnoreCase(t *testing.T) {
	m := StartsWithIgnoreCase("LLM.")

	assert.True(t, m.Matches("llm.chat"))
	assert.True(t, m.Matches("LLM.chat"))
	assert.True(t, m.Matches("LLM.CHAT"))
	assert.False(t, m.Matches("ml.chat"))
}

func TestMatcher_MatchRegex(t *testing.T) {
	re := regexp.MustCompile(`^GET|POST`)
	m := MatchRegex(re)

	assert.True(t, m.Matches("GET /api"))
	assert.True(t, m.Matches("POST /data"))
	assert.False(t, m.Matches("PUT /api"))
	assert.False(t, m.Matches("get /api"))
}

func TestMatcher_MustMatchRegex(t *testing.T) {
	m := MustMatchRegex(`(?i)^GET|POST`)

	assert.True(t, m.Matches("GET /api"))
	assert.True(t, m.Matches("get /api"))
	assert.True(t, m.Matches("POST /data"))
	assert.True(t, m.Matches("post /data"))
	assert.False(t, m.Matches("PUT /api"))
}

func TestMatcher_EmptyMatcher(t *testing.T) {
	m := Matcher{}

	assert.False(t, m.Matches("anything"))
	assert.False(t, m.Matches(""))
}

func TestCriteria_EmptyCriteria(t *testing.T) {
	c := Criteria{}

	// Empty criteria matches everything
	span := mockSpan("any-span", "any-scope")
	assert.True(t, c.Matches(span))
}

func TestCriteria_SpanNameOnly(t *testing.T) {
	c := Criteria{
		SpanName: []Matcher{StartsWith("llm.")},
	}

	assert.True(t, c.Matches(mockSpan("llm.chat", "any-scope")))
	assert.False(t, c.Matches(mockSpan("database.query", "any-scope")))
}

func TestCriteria_ScopeNameOnly(t *testing.T) {
	c := Criteria{
		ScopeName: []Matcher{Equals("my-service")},
	}

	assert.True(t, c.Matches(mockSpan("any-span", "my-service")))
	assert.False(t, c.Matches(mockSpan("any-span", "other-service")))
}

func TestCriteria_BothFieldsANDSemantics(t *testing.T) {
	c := Criteria{
		ScopeName: []Matcher{Equals("my-service")},
		SpanName:  []Matcher{StartsWith("llm.")},
	}

	// Both must match
	assert.True(t, c.Matches(mockSpan("llm.chat", "my-service")))
	assert.False(t, c.Matches(mockSpan("llm.chat", "other-service")))
	assert.False(t, c.Matches(mockSpan("database.query", "my-service")))
	assert.False(t, c.Matches(mockSpan("database.query", "other-service")))
}

func TestCriteria_MatchersWithinFieldORSemantics(t *testing.T) {
	c := Criteria{
		SpanName: []Matcher{
			StartsWith("llm."),
			StartsWith("ai."),
		},
	}

	// Any matcher can match
	assert.True(t, c.Matches(mockSpan("llm.chat", "any")))
	assert.True(t, c.Matches(mockSpan("ai.generate", "any")))
	assert.False(t, c.Matches(mockSpan("database.query", "any")))
}

func TestInclude(t *testing.T) {
	filter := Include(Criteria{
		SpanName: []Matcher{StartsWith("llm.")},
	})

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("llm.chat", "any"),
		mockSpan("llm.embeddings", "any"),
		mockSpan("database.query", "any"),
		mockSpan("http.request", "any"),
	}

	result := filter.Apply(spans)

	assert.Len(t, result, 2)
	assert.Equal(t, "llm.chat", result[0].Name())
	assert.Equal(t, "llm.embeddings", result[1].Name())
}

func TestExclude(t *testing.T) {
	filter := Exclude(Criteria{
		SpanName: []Matcher{StartsWith("database.")},
	})

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("llm.chat", "any"),
		mockSpan("database.query", "any"),
		mockSpan("database.connect", "any"),
		mockSpan("http.request", "any"),
	}

	result := filter.Apply(spans)

	assert.Len(t, result, 2)
	assert.Equal(t, "llm.chat", result[0].Name())
	assert.Equal(t, "http.request", result[1].Name())
}

func TestExcludeHTTPRequests(t *testing.T) {
	filter := ExcludeHTTPRequests()

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("GET /api/users", "net/http"),
		mockSpan("POST /api/data", "net/http"),
		mockSpan("PUT /api/data", "net/http"),
		mockSpan("DELETE /api/data", "net/http"),
		mockSpan("PATCH /api/data", "net/http"),
		mockSpan("OPTIONS /api", "net/http"),
		mockSpan("HEAD /api", "net/http"),
		mockSpan("llm.chat.completion", "openai"),
		mockSpan("database.query", "database/sql"),
		mockSpan("fetch-user", "my-service"), // Not HTTP - doesn't start with HTTP verb
	}

	result := filter.Apply(spans)

	assert.Len(t, result, 3)
	names := make([]string, len(result))
	for i, s := range result {
		names[i] = s.Name()
	}
	assert.Contains(t, names, "llm.chat.completion")
	assert.Contains(t, names, "database.query")
	assert.Contains(t, names, "fetch-user")
}

func TestExcludeHTTPRequests_CaseInsensitive(t *testing.T) {
	filter := ExcludeHTTPRequests()

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("get /api", "any"),
		mockSpan("Get /api", "any"),
		mockSpan("GET /api", "any"),
	}

	result := filter.Apply(spans)

	assert.Len(t, result, 0)
}

func TestLangWatchOnly(t *testing.T) {
	filter := LangWatchOnly()

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("openai.chat", "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"),
		mockSpan("custom-span", "langwatch"),
		mockSpan("tracer-span", "github.com/langwatch/langwatch/sdk-go"),
		mockSpan("query", "database/sql"),
		mockSpan("GET /api", "net/http"),
		mockSpan("process", "my-service"),
		mockSpan("other", "github.com/other/package"),
	}

	result := filter.Apply(spans)

	assert.Len(t, result, 3)
	names := make([]string, len(result))
	for i, s := range result {
		names[i] = s.InstrumentationScope().Name
	}
	assert.Contains(t, names, "github.com/langwatch/langwatch/sdk-go/instrumentation/openai")
	assert.Contains(t, names, "langwatch")
	assert.Contains(t, names, "github.com/langwatch/langwatch/sdk-go")
}

func TestApplyFilters_ANDSemantics(t *testing.T) {
	filters := []Filter{
		ExcludeHTTPRequests(),
		Exclude(Criteria{
			SpanName: []Matcher{StartsWith("database.")},
		}),
	}

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("GET /api", "any"),
		mockSpan("database.query", "any"),
		mockSpan("llm.chat", "any"),
		mockSpan("my-service.process", "any"),
	}

	result := applyFilters(spans, filters)

	assert.Len(t, result, 2)
	names := make([]string, len(result))
	for i, s := range result {
		names[i] = s.Name()
	}
	assert.Contains(t, names, "llm.chat")
	assert.Contains(t, names, "my-service.process")
}

func TestApplyFilters_EmptyFilters(t *testing.T) {
	spans := []sdktrace.ReadOnlySpan{
		mockSpan("span1", "scope1"),
		mockSpan("span2", "scope2"),
	}

	result := applyFilters(spans, nil)

	assert.Equal(t, spans, result)
}

func TestApplyFilters_EmptySpans(t *testing.T) {
	filters := []Filter{ExcludeHTTPRequests()}

	result := applyFilters(nil, filters)

	assert.Len(t, result, 0)
}

func TestApplyFilters_ShortCircuitOnEmpty(t *testing.T) {
	callCount := 0
	trackingFilter := FilterFunc(func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
		callCount++
		return spans
	})

	// First filter removes everything
	filters := []Filter{
		FilterFunc(func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
			return nil // Remove all
		}),
		trackingFilter,
	}

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("span1", "scope1"),
	}

	result := applyFilters(spans, filters)

	assert.Len(t, result, 0)
	assert.Equal(t, 0, callCount) // Second filter should not be called
}

func TestFilterFunc(t *testing.T) {
	// Test that FilterFunc properly implements Filter interface
	customFilter := FilterFunc(func(spans []sdktrace.ReadOnlySpan) []sdktrace.ReadOnlySpan {
		result := make([]sdktrace.ReadOnlySpan, 0)
		for _, s := range spans {
			if s.Name() == "keep-me" {
				result = append(result, s)
			}
		}
		return result
	})

	spans := []sdktrace.ReadOnlySpan{
		mockSpan("keep-me", "any"),
		mockSpan("remove-me", "any"),
	}

	result := customFilter.Apply(spans)

	assert.Len(t, result, 1)
	assert.Equal(t, "keep-me", result[0].Name())
}
