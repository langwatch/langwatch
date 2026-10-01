// Command workerrun fires load through the public API and proves the worker
// processed it: read-back, queue drain, log signatures. See tools/workerrun/README.md.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/langwatch/langwatch/tools/workerrun"
)

func main() {
	root, err := os.Getwd()
	if err != nil {
		root = "."
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := workerrun.Main(ctx, os.Args[1:], workerrun.Env{Out: os.Stdout, ErrOut: os.Stderr, Root: root})
	stop()
	os.Exit(code)
}
