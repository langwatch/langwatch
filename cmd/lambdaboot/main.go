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
	"io"
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
	os.Exit(run(os.Args[1:], lambdaboot.Real, output{out: os.Stdout, err: os.Stderr}))
}

// output is where the command reports to.
type output struct{ out, err io.Writer }

// run parses args, runs the check and returns the exit code: 0 when the image
// started, 1 when it did not, 2 when the arguments are wrong.
func run(args []string, rt lambdaboot.Runtime, w output) int {
	stdout, stderr := w.out, w.err
	var env envFlags
	opts := lambdaboot.Options{}
	flags := flag.NewFlagSet("lambdaboot", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&opts.Image, "image", "", "the image to start (required)")
	flags.StringVar(&opts.User, "user", "9999:9999", "numeric uid:gid to run as; Lambda never runs the image's own USER")
	flags.IntVar(&opts.Port, "port", 8080, "the container port the health check listens on")
	flags.StringVar(&opts.Path, "path", "/healthz", "the health check path")
	flags.DurationVar(&opts.Timeout, "timeout", 60*time.Second, "how long the whole check may take")
	flags.DurationVar(&opts.Interval, "interval", time.Second, "the wait between health check attempts")
	flags.Var(&env, "e", "KEY=VALUE set in the container, as Lambda would (repeatable)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	opts.Env = env

	if opts.Image == "" {
		_, _ = fmt.Fprintln(stderr, "lambdaboot: -image is required")
		return 2
	}
	if err := lambdaboot.Check(context.Background(), opts, rt); err != nil {
		_, _ = fmt.Fprintf(stderr, "::error::%s cannot start the way Lambda starts it, so it is not pushed.\n%v\n", opts.Image, err)
		return 1
	}
	_, _ = fmt.Fprintf(stdout, "%s started as user %s and answered %s.\n", opts.Image, opts.User, opts.Path)
	return 0
}
