package cmd

import (
	"fmt"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/langwatch/langwatch/services/sims/mcpsim"
)

func printMcpStatus(v mcpsim.Status) {
	fmt.Printf("stack %s -> %s (key %s from %s, project %s)\n", v.Stack, v.Endpoint, v.KeyHint, v.KeySource, v.ProjectID)
	fmt.Printf("oauth callback %s", v.CallbackURL)
	if v.AutoApprove != "" {
		fmt.Printf(", auto-approve with %s", v.AutoApprove)
	}
	fmt.Println()
	printMcpGrant(v.OAuth)
	printMcpRuns(v.Runs)
}

func printMcpGrant(g mcpsim.GrantStatus) {
	if !g.Connected {
		fmt.Println("oauth: not connected (haven sim mcp oauth)")
		return
	}
	fmt.Printf("oauth: connected to %s as client %s for project %s (access %s, refresh %s, %d refreshes)", g.Endpoint, g.ClientID, g.ProjectID, g.AccessHint, g.RefreshHint, g.Refreshes)
	if g.ExpiresAt != nil {
		fmt.Printf(", expires %s", g.ExpiresAt.Format(time.RFC3339))
	}
	fmt.Println()
}

func printMcpRuns(runs []mcpsim.RunStatus) {
	if len(runs) == 0 {
		fmt.Println("no runs yet")
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tSCENARIO\tFLOW\tCLIENT\tTRANSPORTS\tSTATE\tDURATION")
	for i := range runs {
		r := &runs[i]
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", r.ID, r.Scenario, r.Flow, r.Client, strings.Join(r.Transports, ","), r.State, mcpMillis(r.DurationMs))
	}
	_ = w.Flush()
}

// printMcpRun is one run: its steps, its checks, then its outcome.
func printMcpRun(st *mcpsim.RunStatus) {
	fmt.Printf("%s: %s, flow %s, client %s -> %s %s\n", st.ID, st.Scenario, st.Flow, st.Client, st.Endpoint, strings.Join(st.Transports, ","))
	printMcpSteps(st.Steps)
	if st.StepsDropped > 0 {
		fmt.Printf("  (%d older steps dropped)\n", st.StepsDropped)
	}
	printMcpChecks(st.Checks)
	printMcpLoad(st.Load)
	if st.AuthorizeURL != "" && st.State == mcpsim.StateWaiting {
		fmt.Printf("approve at %s\n", st.AuthorizeURL)
	}
	if st.Error != "" {
		fmt.Printf("error: %s\n", st.Error)
	}
	fmt.Printf("%s in %s\n", strings.ToUpper(st.State), mcpMillis(st.DurationMs))
}

func printMcpSteps(steps []mcpsim.Step) {
	if len(steps) == 0 {
		return
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "  STEP\tTRANSPORT\tMETHOD\tSTATUS\tMS\tOK\tDETAIL")
	for i := range steps {
		s := &steps[i]
		fmt.Fprintf(w, "  %s\t%s\t%s\t%s\t%.0f\t%t\t%s\n", s.Kind, mcpDash(s.Transport), mcpDash(s.Method), mcpStatus(s.Status), s.LatencyMs, s.OK, mcpStepDetail(s))
	}
	_ = w.Flush()
}

func mcpStepDetail(s *mcpsim.Step) string {
	if s.Error == "" {
		return s.Detail
	}
	return strings.TrimSpace(s.Detail + " error: " + s.Error)
}

func mcpStatus(status int) string {
	if status == 0 {
		return "-"
	}
	return fmt.Sprint(status)
}

func printMcpChecks(checks []mcpsim.Check) {
	for _, c := range checks {
		mark := "PASS"
		if !c.Pass {
			mark = "FAIL"
		}
		line := "  " + mark + " " + c.Name
		if c.Detail != "" {
			line += ": " + c.Detail
		}
		fmt.Println(line)
	}
}

func printMcpLoad(l *mcpsim.LoadStats) {
	if l == nil {
		return
	}
	fmt.Printf("load: %d clients, %d sessions, %d requests, %d errors, %d re-initialized, %d refreshed, %d retried\n",
		l.Clients, l.Sessions, l.Requests, l.Errors, l.Reinitialized, l.Refreshed, l.Retried)
	if l.Latency != nil {
		fmt.Printf("latency ms over %d: p50 %.0f  p90 %.0f  p99 %.0f  max %.0f\n", l.Latency.Samples, l.Latency.P50, l.Latency.P90, l.Latency.P99, l.Latency.Max)
	}
}

func mcpMillis(ms float64) string {
	return (time.Duration(ms) * time.Millisecond).Round(time.Millisecond).String()
}

func mcpDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
