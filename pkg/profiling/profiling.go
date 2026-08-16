// Package profiling starts continuous CPU and heap profiling for a Go service
// and pushes the samples to Pyroscope.
//
// It is deliberately separate from otelsetup rather than another branch inside
// it. otelsetup builds one object graph out of three signals that genuinely
// share plumbing — the same resource, the same collector, the same batching,
// the same shutdown. Profiles share none of it: a different wire protocol, a
// different destination, a different lifecycle, and a sampler that lives in the
// Go runtime rather than in an SDK. The only thing the two have in common is
// the identity a profile has to be labeled with, and that is one function's
// worth of overlap.
//
// The bargain matches the OTLP exporters': a service with nowhere to push to
// starts no profiler, because a profiler with nowhere to push to still samples
// on a timer and still fails every upload, and paying for that in every
// self-hosted install to serve a collector nobody configured is not a trade
// anyone would make deliberately.
package profiling

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/grafana/pyroscope-go"
	"go.uber.org/zap"
)

// ServerAddressEnv is the address of the Pyroscope that profiles are pushed to.
// Unset is the off switch. In local development haven writes it into the
// worktree's .env.portless whenever the shared observability stack is up, so a
// developer gets flame graphs from the same `make haven up` that gives them
// traces; in production it names the in-cluster Pyroscope service.
const ServerAddressEnv = "PYROSCOPE_SERVER_ADDRESS"

// Options configures the profiler. The zero value is disabled.
type Options struct {
	// ServerAddress is the Pyroscope base URL. Empty disables profiling
	// entirely — no profiler, no goroutine, no upload attempts.
	ServerAddress string
	// ServiceName is the Pyroscope application name. It is deliberately the
	// same string the service reports as its OpenTelemetry service.name: a
	// flame graph that cannot be lined up with the trace beside it is a
	// curiosity, and two independently-configured names drift the first time
	// someone renames one of them.
	ServiceName string
	// Environment is the deployment environment, mirrored from the OTel
	// resource for the same reason.
	Environment string
	// Tags are extra labels merged onto every profile. Keys that Pyroscope
	// cannot represent are normalized; see normalizeTagKey.
	Tags map[string]string
	// Logger receives the one line that says profiling started, and any
	// warning about why it did not. Optional.
	Logger *zap.Logger
	// UploadRate is how often accumulated samples are pushed. Zero takes the
	// SDK's default of 15s, which is the right answer for a real deployment:
	// shorter means more requests carrying less each, for a resolution nobody
	// reads a flame graph at.
	UploadRate time.Duration
}

// Profiler is a started profiler. Stop is always safe to call, including on the
// zero value, so callers can defer it without first checking whether profiling
// was enabled.
type Profiler struct {
	p *pyroscope.Profiler
}

// Stop flushes and stops the profiler.
func (p Profiler) Stop() {
	if p.p == nil {
		return
	}
	// Best-effort: this runs on the shutdown path, where the process is on its
	// way out and a failed final flush costs one partial profile.
	_ = p.p.Stop()
}

// Shutdown is Stop in the shape lifecycle.Closer wants, so a service registers
// profiling alongside its other closers rather than hand-rolling a wrapper.
//
// It never reports an error. A profiler that could not flush its last ten
// seconds on the way out has cost one partial flame graph, and reporting that
// as a shutdown failure would make a clean drain look like a dirty one.
func (p Profiler) Shutdown(context.Context) error {
	p.Stop()
	return nil
}

// Start begins continuous profiling, or does nothing when no server address is
// configured.
//
// It never returns an error that a caller is expected to act on, and it never
// stops a service from booting. A process that cannot profile itself is a
// process with one fewer debugging signal; a process that refuses to start
// because it could not profile itself is an outage. The failure is logged as a
// warning and the service serves traffic.
func Start(opts Options) Profiler {
	if opts.ServerAddress == "" {
		return Profiler{}
	}
	if opts.ServiceName == "" {
		warn(opts.Logger, "continuous profiling is configured but the service has no name — profiles would be unattributable, so none are pushed", nil)
		return Profiler{}
	}

	p, err := pyroscope.Start(pyroscope.Config{
		ApplicationName: opts.ServiceName,
		ServerAddress:   opts.ServerAddress,
		Tags:            buildTags(opts),
		UploadRate:      opts.UploadRate,
		// Everything the Go runtime gives us for free. The alloc/inuse pairs are
		// what turn "the pod's RSS climbed all week" into a line number, and they
		// cost nothing beyond the allocation profiler Go already runs.
		ProfileTypes: []pyroscope.ProfileType{
			pyroscope.ProfileCPU,
			pyroscope.ProfileAllocObjects,
			pyroscope.ProfileAllocSpace,
			pyroscope.ProfileInuseObjects,
			pyroscope.ProfileInuseSpace,
			pyroscope.ProfileGoroutines,
		},
		// The SDK logs one line per upload at info. That is a line every ten
		// seconds, forever, in every service, saying nothing a human needs — and
		// in the one case where it matters (uploads failing) the warning below
		// and Pyroscope's own absence of data both say it louder.
		Logger: nil,
	})
	if err != nil {
		warn(opts.Logger, "could not start continuous profiling — the service runs without it", err)
		return Profiler{}
	}

	if opts.Logger != nil {
		opts.Logger.Info("continuous profiling started",
			zap.String("server", opts.ServerAddress),
			zap.String("application", opts.ServiceName),
		)
	}
	return Profiler{p: p}
}

// StartFromEnv is Start with the server address read from the environment, which
// is how every deployment configures it.
func StartFromEnv(serviceName, environment string, logger *zap.Logger) Profiler {
	return Start(Options{
		ServerAddress: strings.TrimSpace(os.Getenv(ServerAddressEnv)),
		ServiceName:   serviceName,
		Environment:   environment,
		Tags:          TagsFromOTelResourceAttributes(os.Getenv("OTEL_RESOURCE_ATTRIBUTES")),
		Logger:        logger,
	})
}

func buildTags(opts Options) map[string]string {
	tags := make(map[string]string, len(opts.Tags)+1)
	for k, v := range opts.Tags {
		if key := normalizeTagKey(k); key != "" && v != "" {
			tags[key] = v
		}
	}
	if opts.Environment != "" {
		tags["environment"] = opts.Environment
	}
	return tags
}

// TagsFromOTelResourceAttributes reads OTEL_RESOURCE_ATTRIBUTES so a profile
// carries whatever identity the other three signals already carry — in local
// development that is langwatch.worktree, which is what lets an agent debugging
// one worktree filter a flame graph down to its own processes while a dozen
// worktrees share one Pyroscope.
//
// The format is the W3C Baggage one OpenTelemetry specifies: comma-separated
// key=value pairs.
func TagsFromOTelResourceAttributes(raw string) map[string]string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	tags := map[string]string{}
	for pair := range strings.SplitSeq(raw, ",") {
		key, value, found := strings.Cut(pair, "=")
		if !found {
			continue
		}
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if normalized := normalizeTagKey(key); normalized != "" && value != "" {
			tags[normalized] = value
		}
	}
	if len(tags) == 0 {
		return nil
	}
	return tags
}

// normalizeTagKey maps an OpenTelemetry attribute name onto a Pyroscope label
// name. OTel names are dotted (langwatch.worktree); Pyroscope label names follow
// the Prometheus grammar and reject a dot outright, so a key copied across
// verbatim is silently dropped along with the tag it carried.
//
// Underscore is the same substitution Loki's structured metadata already makes
// for the same attribute (langwatch_worktree), so one spelling works across the
// signals rather than one per store.
func normalizeTagKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(key))
	for i, r := range key {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '_':
			b.WriteRune(r)
		case r >= '0' && r <= '9' && i > 0:
			b.WriteRune(r)
		default:
			// A leading digit is as invalid as a dot, so the substitution has to
			// be a letter-or-underscore rather than a drop.
			b.WriteRune('_')
		}
	}
	return b.String()
}

func warn(logger *zap.Logger, message string, err error) {
	if logger == nil {
		// No logger is the pre-boot case. Silence here is the failure mode this
		// whole file exists to avoid, so it goes to stderr rather than nowhere.
		if err != nil {
			fmt.Fprintf(os.Stderr, "[profiling] %s: %v\n", message, err)
			return
		}
		fmt.Fprintf(os.Stderr, "[profiling] %s\n", message)
		return
	}
	if err != nil {
		logger.Warn(message, zap.Error(err))
		return
	}
	logger.Warn(message)
}
