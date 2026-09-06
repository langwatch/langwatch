// Command visualdiff renders every route and every flow in visualdiff.yaml on
// two refs of this repository and reports every screen that differs.
package main

import (
	"context"
	"os"

	"github.com/langwatch/langwatch/tools/visualdiff"
)

func main() {
	os.Exit(visualdiff.Run(context.Background(), os.Args[1:], visualdiff.Streams{Out: os.Stdout, Err: os.Stderr}))
}
