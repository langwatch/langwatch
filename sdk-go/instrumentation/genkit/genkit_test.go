package genkit

import (
	"context"
	"testing"

	"github.com/firebase/genkit/go/core/tracing"
	"github.com/firebase/genkit/go/genkit"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// noopExporterOpts configures the LangWatch exporter against a non-routable
// endpoint with a placeholder key, so construction never depends on a live
// server (the OTLP HTTP client is lazy and only dials on export).
func noopExporterOpts() []langwatch.ExporterOption {
	return []langwatch.ExporterOption{
		langwatch.WithEndpoint("http://127.0.0.1:0"),
		langwatch.WithAPIKey("test"),
	}
}

func TestSpanProcessor(t *testing.T) {
	t.Run("given the default exporter path", func(t *testing.T) {
		t.Run("it builds a batching processor without error or network", func(t *testing.T) {
			sp, err := SpanProcessor(WithExporterOptions(noopExporterOpts()...))
			require.NoError(t, err)
			require.NotNil(t, sp)
			require.NoError(t, sp.Shutdown(context.Background()))
		})
	})

	t.Run("when a custom processor is supplied", func(t *testing.T) {
		t.Run("it returns that processor unchanged", func(t *testing.T) {
			exp := tracetest.NewInMemoryExporter()
			custom := sdktrace.NewSimpleSpanProcessor(exp)

			sp, err := SpanProcessor(
				WithSpanProcessor(custom),
				// These are ignored in favour of the custom processor.
				WithExporterOptions(noopExporterOpts()...),
			)
			require.NoError(t, err)
			assert.Same(t, custom, sp, "custom processor is returned as-is")
		})
	})
}

func TestRegisterLangWatch(t *testing.T) {
	t.Run("given an initialized Genkit instance", func(t *testing.T) {
		g := newGenkit(t)

		t.Run("it registers a LangWatch exporter processor without error", func(t *testing.T) {
			err := RegisterLangWatch(g, WithExporterOptions(noopExporterOpts()...))
			require.NoError(t, err)
		})
	})

	t.Run("when registering a custom processor", func(t *testing.T) {
		t.Run("Genkit's own spans flow into the registered processor", func(t *testing.T) {
			g := newGenkit(t)

			// Register an in-memory processor on the provider Genkit emits onto.
			exp := tracetest.NewInMemoryExporter()
			err := RegisterLangWatch(g, WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(exp)))
			require.NoError(t, err)

			// Emit a Genkit span the same way flows/steps do (onto the global
			// tracer provider that RegisterLangWatch targeted).
			_, err = tracing.RunInNewSpan(
				context.Background(),
				&tracing.SpanMetadata{Name: "lw-wiring-probe", Type: "flowStep"},
				nil,
				func(context.Context, any) (any, error) { return nil, nil },
			)
			require.NoError(t, err)

			spans := exp.GetSpans()
			names := make([]string, len(spans))
			for i, s := range spans {
				names[i] = s.Name
			}
			assert.Contains(t, names, "lw-wiring-probe",
				"the registered processor received the Genkit span, proving it is wired to Genkit's tracer provider")
		})
	})
}

// newGenkit initializes a real *genkit.Genkit offline. genkit.Init only starts
// the reflection server when GENKIT_ENV=dev; the default (prod) environment
// needs no network or plugins. If a future Genkit version makes Init require
// connectivity, this skips rather than failing the suite.
func newGenkit(t *testing.T) *genkit.Genkit {
	t.Helper()
	t.Setenv("GENKIT_ENV", "")
	defer func() {
		if r := recover(); r != nil {
			t.Skipf("genkit.Init could not initialize offline: %v", r)
		}
	}()
	g := genkit.Init(context.Background())
	require.NotNil(t, g)
	return g
}
