package gatewaymetrics

import (
	"strings"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	promotel "go.opentelemetry.io/contrib/bridges/prometheus"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
)

// runtimeFamilyPrefixes are the Go runtime and process collectors. The OTLP
// push already carries the OTel runtime instrumentation for the same facts
// (go_memory_*, go_goroutine_count), so bridging these would send each twice
// under different names.
var runtimeFamilyPrefixes = []string{"go_", "process_"}

// OTelProducer exposes this recorder's collectors to an OTLP metric reader.
//
// The gateway keeps its instruments in a Prometheus registry, and that
// registry is served only on the pull door. A deployment that pushes metrics
// over OTLP and never scrapes the door would otherwise see none of the
// gateway_* series: gateway_http_requests_total and its latency histogram
// would be missing from the backend while the pod ran healthy.
//
// Returns nil on a nil recorder.
func (r *Recorder) OTelProducer() sdkmetric.Producer {
	if r == nil || r.registry == nil {
		return nil
	}
	return promotel.NewMetricProducer(promotel.WithGatherer(withoutRuntimeFamilies{r.registry}))
}

// withoutRuntimeFamilies drops the runtime and process families from a gather.
type withoutRuntimeFamilies struct{ source prometheus.Gatherer }

func (g withoutRuntimeFamilies) Gather() ([]*dto.MetricFamily, error) {
	families, err := g.source.Gather()
	kept := families[:0]
	for _, family := range families {
		if !hasRuntimePrefix(family.GetName()) {
			kept = append(kept, family)
		}
	}
	return kept, err
}

func hasRuntimePrefix(name string) bool {
	for _, prefix := range runtimeFamilyPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}
