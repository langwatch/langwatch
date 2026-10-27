// Command scenariorunner is the Go scenario runner, spawned by the worker in
// place of the Node scenario child: one job on stdin, its result as the last
// JSON line on stdout, exit 0 or 1.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/langwatch/langwatch/services/scenariorunner"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	env := scenariorunner.ReadEnv(os.Getenv, os.Stderr)
	code := scenariorunner.Run(ctx, env, scenariorunner.IO{Stdin: os.Stdin, Stdout: os.Stdout, Stderr: os.Stderr})
	stop()
	os.Exit(code)
}
