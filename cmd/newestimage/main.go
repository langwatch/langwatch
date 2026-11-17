// Command newestimage reads `aws ecr describe-images` JSON on stdin and prints
// the image pushed last whose tag starts with -prefix, as GitHub output lines
// (tag=, digest=). It fails when there is none or it is not an image for
// several platforms (tools/newestimage).
//
// Usage:
//
//	aws ecr describe-images --repository-name R --filter tagStatus=TAGGED --output json | go run ./cmd/newestimage -prefix http-git-
//
// Spec: specs/ci/pii-redaction-model-release.feature
package main

import (
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/langwatch/langwatch/tools/newestimage"
)

func main() {
	prefix := flag.String("prefix", "", "tag prefix to pick from, e.g. http-git-")
	flag.Parse()
	if *prefix == "" {
		fmt.Fprintln(os.Stderr, "newestimage: -prefix is required")
		os.Exit(2)
	}
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "newestimage:", err)
		os.Exit(1)
	}
	img, err := newestimage.Pick(data, *prefix)
	if err != nil {
		fmt.Fprintln(os.Stderr, "newestimage:", err)
		os.Exit(1)
	}
	fmt.Print(img.Outputs())
}
