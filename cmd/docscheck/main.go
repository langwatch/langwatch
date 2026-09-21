// Command docscheck fails when the docs site publishes a page nobody navigates
// to, sends a reader through a redirect that dead-ends or bounces twice, or
// names a release the chart no longer ships.
//
// These are the gaps the Mintlify CLI leaves: `mint validate` builds the site
// and `mint broken-links` follows links, but an unreferenced page still builds
// and is still served at its URL, so nothing upstream ever reports it.
//
// Usage: docscheck [-root .] [-docs docs] [-chart charts/langwatch/Chart.yaml] [-json]
//
// The rules live in pkg/docsscan and the loading in tools/docscheck; this is
// only the process shell.
package main

import (
	"os"

	"github.com/langwatch/langwatch/tools/docscheck"
)

func main() {
	os.Exit(docscheck.Run(os.Args[1:], os.Stdout, os.Stderr))
}
