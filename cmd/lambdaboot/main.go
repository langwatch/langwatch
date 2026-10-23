// Command lambdaboot starts a built Lambda image as a foreign, non-root user
// with a read-only root, and fails unless its health check answers 200 within
// the timeout. publish-docker-ecr runs it before a Lambda image is pushed, so
// an image that cannot start on Lambda never gets a tag.
// Spec: specs/ci/publish-ecr-images.feature
//
// Usage:
//
//	go run ./cmd/lambdaboot -image langwatch-nlp-lambda:boot-check -e STUDIO_RUNTIME=async
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/lambdaboot"
)

type envFlags []string

func (e *envFlags) String() string { return strings.Join(*e, ",") }

func (e *envFlags) Set(kv string) error {
	*e = append(*e, kv)
	return nil
}

func main() {
	var env envFlags
	opts := lambdaboot.Options{}
	flag.StringVar(&opts.Image, "image", "", "the image to start (required)")
	flag.StringVar(&opts.User, "user", "9999:9999", "uid:gid to run as; Lambda never runs the image's own USER")
	flag.IntVar(&opts.Port, "port", 8080, "the container port the health check listens on")
	flag.StringVar(&opts.Path, "path", "/healthz", "the health check path")
	flag.DurationVar(&opts.Timeout, "timeout", 60*time.Second, "how long the health check may take to answer")
	flag.DurationVar(&opts.Interval, "interval", time.Second, "the wait between health check attempts")
	flag.Var(&env, "e", "KEY=VALUE set in the container, as Lambda would (repeatable)")
	flag.Parse()
	opts.Env = env

	if opts.Image == "" {
		fmt.Fprintln(os.Stderr, "lambdaboot: -image is required")
		os.Exit(2)
	}
	if err := lambdaboot.Check(context.Background(), opts, lambdaboot.Real); err != nil {
		fmt.Fprintf(os.Stderr, "::error::%s cannot start the way Lambda starts it, so it is not pushed.\n%v\n", opts.Image, err)
		os.Exit(1)
	}
	fmt.Printf("%s started as user %s and answered %s.\n", opts.Image, opts.User, opts.Path)
}
