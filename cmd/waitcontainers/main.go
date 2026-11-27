// Command waitcontainers holds a CI step until the named containers, started in
// the background with a --health-cmd, report healthy. On a timeout it prints the
// start log, docker ps -a and the container's last log lines, and exits 1.
//
// Usage:
//
//	go run ./cmd/waitcontainers -start-log "$RUNNER_TEMP/datastores.log" -timeout 150s postgres redis
//
// Spec: specs/ci/app-ci-datastores.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/waitcontainers"
)

func main() {
	startLog := flag.String("start-log", "", "the log the background start wrote")
	timeout := flag.Duration("timeout", 150*time.Second, "how long to wait for all containers together")
	flag.Parse()

	w := waitcontainers.Waiter{
		Names:    flag.Args(),
		StartLog: *startLog,
		Docker:   waitcontainers.CLI{},
		Interval: time.Second,
		Timeout:  *timeout,
		Log:      os.Stdout,
	}
	if err := w.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "::error::waitcontainers: %v\n", err)
		os.Exit(2)
	}
	if err := w.Wait(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "::error::%v\n", err)
		os.Exit(1)
	}
}
