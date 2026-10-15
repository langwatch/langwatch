package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	analyticssim "github.com/langwatch/langwatch/services/sims/analyticssim/cmd"
	githubsim "github.com/langwatch/langwatch/services/sims/githubsim/cmd"
	idpsim "github.com/langwatch/langwatch/services/sims/idpsim/cmd"
	lambdasim "github.com/langwatch/langwatch/services/sims/lambdasim/cmd"
	llmsim "github.com/langwatch/langwatch/services/sims/llmsim/cmd"
	mailsim "github.com/langwatch/langwatch/services/sims/mailsim/cmd"
	mcpsim "github.com/langwatch/langwatch/services/sims/mcpsim/cmd"
	outboundsim "github.com/langwatch/langwatch/services/sims/outboundsim/cmd"
	paymentsim "github.com/langwatch/langwatch/services/sims/paymentsim/cmd"
	storagesim "github.com/langwatch/langwatch/services/sims/storagesim/cmd"
	telemetrysim "github.com/langwatch/langwatch/services/sims/telemetrysim/cmd"
	voicesim "github.com/langwatch/langwatch/services/sims/voicesim/cmd"
)

// The supervising parent outlives its children, including when go run owns the
// temporary executable. Reusing that executable never compiles an old checkout.
func simulatorArgv() []string {
	executable, err := os.Executable()
	if err != nil {
		panic(fmt.Errorf("locating Haven's simulator executable: %w", err))
	}
	return []string{executable, "simulator"}
}

func runBundledSimulator(ctx context.Context, _ deps, inv invocation) error {
	if len(inv.args) != 1 {
		return fmt.Errorf("haven simulator requires mail, idp, storage, voice, llm, analytics, outbound, payment, telemetry, lambda, github or mcp")
	}

	var run func(context.Context, []string) error
	var service string
	switch inv.args[0] {
	case "mail":
		run, service = mailsim.Root, "mailsim"
	case "idp":
		run, service = idpsim.Root, "idpsim"
	case "storage":
		run, service = storagesim.Root, "storagesim"
	case "voice":
		run, service = voicesim.Root, "voicesim"
	case "llm":
		run, service = llmsim.Root, "llmsim"
	case "analytics":
		run, service = analyticssim.Root, "analyticssim"
	case "outbound":
		run, service = outboundsim.Root, "outboundsim"
	case "payment":
		run, service = paymentsim.Root, "paymentsim"
	case "telemetry":
		run, service = telemetrysim.Root, "telemetrysim"
	case "lambda":
		run, service = lambdasim.Root, "lambdasim"
	case "github":
		run, service = githubsim.Root, "githubsim"
	case "mcp":
		run, service = mcpsim.Root, "mcpsim"
	default:
		return fmt.Errorf("unknown simulator %q — use mail, idp, storage, voice, llm, analytics, outbound, payment, telemetry, lambda, github or mcp", inv.args[0])
	}

	info := *contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-" + service
	ctx = contexts.SetServiceInfo(ctx, info)
	ctx = clog.Set(ctx, clog.New(ctx, clog.Config{Level: "info"}))
	return run(ctx, nil)
}
