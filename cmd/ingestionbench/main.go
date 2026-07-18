// Command ingestionbench drives the event-sourcing ingestion benchmark: it
// sends synthetic OTLP load through the real collector, then asserts in
// ClickHouse that no span was lost, double-counted, or leaked across tenants.
//
// Usage:
//
//	ingestionbench seed -count 4
//	ingestionbench run -clickhouse "$CLICKHOUSE_URL" -tenants "$TENANTS" -scale 1
//
// The rules live in tools/ingestionbench; this is only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/ingestionbench"
)

func main() {
	os.Exit(ingestionbench.Run(os.Args[1:], os.Stdout, os.Stderr))
}
