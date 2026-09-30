package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	idpsim "github.com/langwatch/langwatch/services/idpsim/cmd"
	llmsim "github.com/langwatch/langwatch/services/llmsim/cmd"
	mailsim "github.com/langwatch/langwatch/services/mailsim/cmd"
	storagesim "github.com/langwatch/langwatch/services/storagesim/cmd"
	voicesim "github.com/langwatch/langwatch/services/voicesim/cmd"
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
		return fmt.Errorf("haven simulator requires mail, idp, storage, voice or llm")
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
	default:
		return fmt.Errorf("unknown simulator %q — use mail, idp, storage, voice or llm", inv.args[0])
	}

	info := *contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-" + service
	ctx = contexts.SetServiceInfo(ctx, info)
	ctx = clog.Set(ctx, clog.New(ctx, clog.Config{Level: "info"}))
	return run(ctx, nil)
}
