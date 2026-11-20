// Command newestimage reads `aws ecr describe-images` JSON on stdin and prints
// the image pushed last whose tag starts with -prefix, as GitHub output lines
// (tag=, digest=, reused=). It fails when there is none or it is not an image
// for several platforms (tools/newestimage).
//
// With -released, the digest the release's version tag already holds on
// Docker Hub, it prints that image instead (reused=true), so a re-run never
// moves the version.
//
// With -platforms, stdin is a raw image index instead, and it fails unless the
// index holds an image for each platform in the comma-separated list.
//
// Usage:
//
//	aws ecr describe-images --repository-name R --filter tagStatus=TAGGED --output json | go run ./cmd/newestimage -prefix http-git- -released "$RELEASED"
//	docker buildx imagetools inspect --raw R@DIGEST | go run ./cmd/newestimage -platforms linux/amd64,linux/arm64
//
// Spec: specs/ci/pii-redaction-model-release.feature
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/newestimage"
)

func main() {
	prefix := flag.String("prefix", "", "tag prefix to pick from, e.g. http-git-")
	released := flag.String("released", "", "digest the release's version tag already holds; reused instead of picking")
	platforms := flag.String("platforms", "", "check a raw image index on stdin for these platforms, e.g. linux/amd64,linux/arm64")
	flag.Parse()
	if (*prefix == "") == (*platforms == "") {
		fmt.Fprintln(os.Stderr, "newestimage: give -prefix, or -platforms, but not both")
		os.Exit(2)
	}
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, "newestimage:", err)
		os.Exit(1)
	}
	if *platforms != "" {
		if err := newestimage.CheckPlatforms(data, strings.Split(*platforms, ",")...); err != nil {
			fmt.Fprintln(os.Stderr, "newestimage:", err)
			os.Exit(1)
		}

		return
	}
	img, err := newestimage.PickOrReuse(data, *prefix, *released)
	if err != nil {
		fmt.Fprintln(os.Stderr, "newestimage:", err)
		os.Exit(1)
	}
	fmt.Print(img.Outputs())
}
