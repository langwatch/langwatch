package cmd

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"slices"
	"strconv"

	"github.com/langwatch/langwatch/services/telemetrysim"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// telemetryPostRequest maps the flags onto one request: --body-file, else
// --fixture, else --preset (default llm-trace), at --target or the stack's door.
func telemetryPostRequest(inv invocation, overlay []string) (telemetrysim.SendOneRequest, error) {
	req := telemetrysim.SendOneRequest{
		Preset: inv.value("--preset"), Fixture: inv.value("--fixture"), Seed: 1,
		Encoding: telemetrysim.Encoding(inv.value("--encoding")), NoGzip: inv.has("--no-gzip"),
	}
	if path := inv.value("--body-file"); path != "" {
		body, err := os.ReadFile(path)
		if err != nil {
			return req, fmt.Errorf("reading --body-file: %w", err)
		}
		req.Body = string(body)
	}
	if raw := inv.value("--seed"); raw != "" {
		seed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return req, fmt.Errorf("--seed %q is not a whole number", raw)
		}
		req.Seed = seed
	}
	var err error
	req.Endpoint, req.APIKey, err = telemetryTarget(inv, overlay)
	return req, err
}

// telemetryPost sends one request and prints the door's answer. It exits zero
// whatever the door said: a refusal is an answer, not a failure of the verb.
func telemetryPost(api sources.SimAPI, req telemetrysim.SendOneRequest, asJSON bool) error {
	var raw json.RawMessage
	if err := api.Post("/_sim/api/send-one", req, &raw); err != nil {
		return err
	}
	if asJSON {
		return printSimRaw(raw)
	}
	var a telemetrysim.SendOneAnswer
	if err := json.Unmarshal(raw, &a); err != nil {
		return err
	}
	fmt.Printf("POST %s (%s, %s, gzip %t, %d bytes) in %.1f ms\n", a.URL, a.Signal, a.Encoding, a.Gzip, a.Bytes, a.LatencyMs)
	if a.Error != "" {
		fmt.Printf("no answer: %s\n", a.Error)
		return nil
	}
	fmt.Printf("the door answered %d %s\n", a.Status, a.ContentType)
	if a.RetryAfter != "" {
		fmt.Printf("Retry-After: %s\n", a.RetryAfter)
	}
	if a.Body != "" {
		fmt.Println(a.Body)
	}
	return nil
}

func printTelemetryAnswers(st *telemetrysim.RunStatus) {
	if len(st.Answers) > 0 {
		fmt.Print("answers")
		for _, code := range slices.Sorted(maps.Keys(st.Answers)) {
			fmt.Printf("  %d x%d", code, st.Answers[code])
		}
		fmt.Println()
	}
	if st.RetryAfterSeen > 0 {
		fmt.Printf("Retry-After seen %d times, last %q\n", st.RetryAfterSeen, st.LastRetryAfter)
	}
	if l := st.Latency; l != nil {
		fmt.Printf("latency ms  p50 %.1f  p90 %.1f  p99 %.1f  max %.1f  (%d attempts)\n", l.P50, l.P90, l.P99, l.Max, l.Samples)
	}
}

type telemetryRuns struct {
	Runs []telemetrysim.RunStatus `json:"runs"`
}

type telemetryFixtures struct {
	Fixtures []telemetrysim.Fixture `json:"fixtures"`
}

func printTelemetryRuns(v telemetryRuns) {
	if len(v.Runs) == 0 {
		fmt.Println("no runs yet")
	}
	for i := range v.Runs {
		r := &v.Runs[i]
		fmt.Printf("%-8s %-8s %-5s %-20s seed %-6d sent %-6d acked %-6d refused %-6d failed %d\n",
			r.ID, r.State, r.Mode, r.Preset, r.Seed, r.Sent, r.Acked, r.Refused, r.Failed)
	}
}

func printTelemetryFixtures(v telemetryFixtures) {
	for _, f := range v.Fixtures {
		fmt.Printf("%-9s %-32s %s\n", f.Kind, f.Name, f.Signal)
	}
}
