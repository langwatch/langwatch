// Package main demonstrates LangWatch span filtering capabilities.
// This example shows how filters work without requiring external services.
package main

import (
	"context"
	"fmt"
	"sync"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// mockExporter captures spans for inspection instead of sending them.
type mockExporter struct {
	mu    sync.Mutex
	spans []sdktrace.ReadOnlySpan
}

func (m *mockExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spans = append(m.spans, spans...)
	return nil
}

func (m *mockExporter) Shutdown(ctx context.Context) error { return nil }

func (m *mockExporter) GetSpans() []sdktrace.ReadOnlySpan {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.spans
}

func (m *mockExporter) Clear() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.spans = nil
}

func main() {
	ctx := context.Background()

	fmt.Println("=== LangWatch Filter Demo ===")
	fmt.Println()

	// Test 1: No filters (all spans pass through)
	fmt.Println("Test 1: No filters")
	testFiltering(ctx, nil, []string{
		"GET /api/users",
		"POST /api/data",
		"llm.chat.completion",
		"database.query",
		"my-service.process",
	})

	// Test 2: ExcludeHTTPRequests preset
	fmt.Println()
	fmt.Println("Test 2: ExcludeHTTPRequests preset")
	testFiltering(ctx, []langwatch.Filter{
		langwatch.ExcludeHTTPRequests(),
	}, []string{
		"GET /api/users",
		"POST /api/data",
		"llm.chat.completion",
		"database.query",
	})

	// Test 3: Include only LLM spans
	fmt.Println()
	fmt.Println("Test 3: Include spans starting with 'llm.'")
	testFiltering(ctx, []langwatch.Filter{
		langwatch.Include(langwatch.Criteria{
			SpanName: []langwatch.Matcher{
				langwatch.StartsWith("llm."),
			},
		}),
	}, []string{
		"llm.chat.completion",
		"llm.embeddings",
		"database.query",
		"my-service.process",
	})

	// Test 4: Exclude database spans
	fmt.Println()
	fmt.Println("Test 4: Exclude spans starting with 'database.'")
	testFiltering(ctx, []langwatch.Filter{
		langwatch.Exclude(langwatch.Criteria{
			SpanName: []langwatch.Matcher{
				langwatch.StartsWith("database."),
			},
		}),
	}, []string{
		"llm.chat.completion",
		"database.query",
		"database.connect",
		"my-service.process",
	})

	// Test 5: Filter by scope name
	fmt.Println()
	fmt.Println("Test 5: Include only 'my-service' scope")
	testFilteringWithScopes(ctx, []langwatch.Filter{
		langwatch.Include(langwatch.Criteria{
			ScopeName: []langwatch.Matcher{
				langwatch.Equals("my-service"),
			},
		}),
	}, []struct {
		scope string
		name  string
	}{
		{"my-service", "process"},
		{"my-service", "handle"},
		{"database", "query"},
		{"http-client", "GET /api"},
	})

	// Test 6: Combined filters (AND semantics)
	fmt.Println()
	fmt.Println("Test 6: Exclude HTTP AND exclude database (AND semantics)")
	testFiltering(ctx, []langwatch.Filter{
		langwatch.ExcludeHTTPRequests(),
		langwatch.Exclude(langwatch.Criteria{
			SpanName: []langwatch.Matcher{
				langwatch.StartsWith("database."),
			},
		}),
	}, []string{
		"GET /api/users",
		"database.query",
		"llm.chat.completion",
		"my-service.process",
	})

	// Test 7: Case-insensitive matching
	fmt.Println()
	fmt.Println("Test 7: Case-insensitive matching")
	testFiltering(ctx, []langwatch.Filter{
		langwatch.Include(langwatch.Criteria{
			SpanName: []langwatch.Matcher{
				langwatch.EqualsIgnoreCase("LLM.CHAT.COMPLETION"),
			},
		}),
	}, []string{
		"llm.chat.completion",
		"LLM.CHAT.COMPLETION",
		"Llm.Chat.Completion",
		"other.span",
	})

	// Test 8: OR semantics within matchers
	fmt.Println()
	fmt.Println("Test 8: OR semantics - include 'llm.' OR 'ai.' prefixes")
	testFiltering(ctx, []langwatch.Filter{
		langwatch.Include(langwatch.Criteria{
			SpanName: []langwatch.Matcher{
				langwatch.StartsWith("llm."),
				langwatch.StartsWith("ai."),
			},
		}),
	}, []string{
		"llm.chat",
		"ai.generate",
		"database.query",
		"http.request",
	})

	// Test 9: LangWatchOnly preset
	fmt.Println()
	fmt.Println("Test 9: LangWatchOnly preset - keeps only LangWatch instrumentation")
	testFilteringWithScopes(ctx, []langwatch.Filter{
		langwatch.LangWatchOnly(),
	}, []struct {
		scope string
		name  string
	}{
		{"github.com/langwatch/langwatch/sdk-go/instrumentation/openai", "openai.completions"},
		{"langwatch", "custom-span"},
		{"github.com/langwatch/langwatch/sdk-go", "tracer-span"},
		{"database/sql", "query"},
		{"net/http", "GET /api"},
		{"my-service", "process"},
		{"github.com/other/package", "other-span"},
	})

	fmt.Println()
	fmt.Println("=== All tests completed ===")
}

func testFiltering(ctx context.Context, filters []langwatch.Filter, spanNames []string) {
	mock := &mockExporter{}

	// Create filtering exporter wrapping the mock
	filteringExporter := langwatch.NewFilteringExporter(mock, filters...)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(filteringExporter), // Syncer for immediate export
	)
	otel.SetTracerProvider(tp)

	tracer := otel.Tracer("test-tracer")

	// Create spans
	for _, name := range spanNames {
		_, span := tracer.Start(ctx, name)
		span.End()
	}

	// Force flush
	tp.ForceFlush(ctx)

	// Report results
	exportedSpans := mock.GetSpans()
	fmt.Printf("  Input spans:    %v\n", spanNames)
	fmt.Printf("  Exported spans: ")
	names := make([]string, len(exportedSpans))
	for i, s := range exportedSpans {
		names[i] = s.Name()
	}
	fmt.Printf("%v\n", names)
	fmt.Printf("  Filtered out:   %d spans\n", len(spanNames)-len(exportedSpans))
}

func testFilteringWithScopes(ctx context.Context, filters []langwatch.Filter, spans []struct {
	scope string
	name  string
}) {
	mock := &mockExporter{}
	filteringExporter := langwatch.NewFilteringExporter(mock, filters...)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(filteringExporter),
	)

	// Create spans with different scopes
	for _, s := range spans {
		tracer := tp.Tracer(s.scope)
		_, span := tracer.Start(ctx, s.name)
		span.End()
	}

	tp.ForceFlush(ctx)

	exportedSpans := mock.GetSpans()
	fmt.Printf("  Input:    ")
	for _, s := range spans {
		fmt.Printf("[%s/%s] ", s.scope, s.name)
	}
	fmt.Println()
	fmt.Printf("  Exported: ")
	for _, s := range exportedSpans {
		fmt.Printf("[%s/%s] ", s.InstrumentationScope().Name, s.Name())
	}
	fmt.Println()
	fmt.Printf("  Filtered out: %d spans\n", len(spans)-len(exportedSpans))
}
