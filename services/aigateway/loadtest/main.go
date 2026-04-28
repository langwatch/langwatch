// Command loadtest runs a sustained-RPS load test against a gateway endpoint
// using vegeta and reports latency percentiles + error rates.
//
// Usage:
//
//	go run ./services/aigateway/loadtest \
//	  -rps=1000 -duration=30s \
//	  -target=http://localhost:5563/v1/chat/completions \
//	  -token=lw_vk_test_...
//
// Outputs a text histogram to stdout and a full vegeta binary report to
// results.bin (for post-hoc analysis with `vegeta report` / `vegeta plot`).
package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	vegeta "github.com/tsenart/vegeta/v12/lib"
)

func main() {
	var (
		rps      = flag.Int("rps", 100, "requests per second")
		duration = flag.Duration("duration", 30*time.Second, "test duration")
		target   = flag.String("target", "http://localhost:5563/v1/chat/completions", "target URL")
		token    = flag.String("token", "", "virtual key (Bearer token)")
		model    = flag.String("model", "gpt-5-mini", "model to request")
		stream   = flag.Bool("stream", false, "enable streaming")
		output   = flag.String("output", "results.bin", "vegeta binary report output path")
		workers  = flag.Uint64("workers", 50, "concurrent workers")
	)
	flag.Parse()

	if *token == "" {
		fmt.Fprintln(os.Stderr, "error: -token is required")
		os.Exit(1)
	}

	body := fmt.Sprintf(
		`{"model":%q,"messages":[{"role":"user","content":"ping"}],"max_tokens":4,"stream":%v}`,
		*model, *stream,
	)

	targeter := vegeta.NewStaticTargeter(vegeta.Target{
		Method: http.MethodPost,
		URL:    *target,
		Header: http.Header{
			"Authorization": []string{"Bearer " + *token},
			"Content-Type":  []string{"application/json"},
		},
		Body: []byte(body),
	})

	rate := vegeta.Rate{Freq: *rps, Per: time.Second}
	attacker := vegeta.NewAttacker(
		vegeta.Workers(*workers),
		vegeta.Timeout(30*time.Second),
	)

	fmt.Fprintf(os.Stderr, "Starting load test: %d RPS for %s against %s\n", *rps, *duration, *target)
	fmt.Fprintf(os.Stderr, "Model: %s, Stream: %v, Workers: %d\n\n", *model, *stream, *workers)

	var metrics vegeta.Metrics

	// Open output file for binary results (enables `vegeta report`/`vegeta plot` post-hoc).
	outFile, err := os.Create(*output)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error creating output file: %v\n", err)
		os.Exit(1)
	}
	defer outFile.Close()
	encoder := vegeta.NewEncoder(outFile)

	for res := range attacker.Attack(targeter, rate, *duration, "gateway-loadtest") {
		metrics.Add(res)
		_ = encoder.Encode(res)
	}
	metrics.Close()

	// Print summary.
	fmt.Println("── Load Test Results ──────────────────────────────────────────")
	fmt.Printf("Duration:      %s\n", metrics.Duration.Round(time.Millisecond))
	fmt.Printf("Requests:      %d\n", metrics.Requests)
	fmt.Printf("Rate:          %.2f req/s\n", metrics.Rate)
	fmt.Printf("Throughput:    %.2f req/s\n", metrics.Throughput)
	fmt.Printf("Success:       %.2f%%\n", metrics.Success*100)
	fmt.Println()
	fmt.Println("── Latency ────────────────────────────────────────────────────")
	fmt.Printf("  min:   %s\n", metrics.Latencies.Min.Round(time.Microsecond))
	fmt.Printf("  mean:  %s\n", metrics.Latencies.Mean.Round(time.Microsecond))
	fmt.Printf("  p50:   %s\n", metrics.Latencies.P50.Round(time.Microsecond))
	fmt.Printf("  p90:   %s\n", metrics.Latencies.P90.Round(time.Microsecond))
	fmt.Printf("  p95:   %s\n", metrics.Latencies.P95.Round(time.Microsecond))
	fmt.Printf("  p99:   %s\n", metrics.Latencies.P99.Round(time.Microsecond))
	fmt.Printf("  max:   %s\n", metrics.Latencies.Max.Round(time.Microsecond))
	fmt.Println()
	fmt.Println("── Status Codes ───────────────────────────────────────────────")
	for code, count := range metrics.StatusCodes {
		fmt.Printf("  %s: %d\n", code, count)
	}
	if len(metrics.Errors) > 0 {
		fmt.Println()
		fmt.Println("── Errors (first 10) ──────────────────────────────────────────")
		for i, e := range metrics.Errors {
			if i >= 10 {
				fmt.Printf("  ... and %d more\n", len(metrics.Errors)-10)
				break
			}
			fmt.Printf("  %s\n", e)
		}
	}
	fmt.Println()
	fmt.Printf("Full binary report saved to: %s\n", *output)
	fmt.Println("Post-hoc analysis:")
	fmt.Printf("  vegeta report %s\n", *output)
	fmt.Printf("  vegeta report -type=hist[0,1ms,5ms,10ms,50ms,100ms,500ms,1s] %s\n", *output)
	fmt.Printf("  vegeta plot %s > plot.html\n", *output)
}
