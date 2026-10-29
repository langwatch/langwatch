// Command ecrtag checks and writes image tags in the artifacts ECR, whose tags
// are immutable, for publish-docker-ecr.yml and publish-docker-private.yml.
//
// Usage:
//
//	go run ./cmd/ecrtag published -repository R -tag T -source label|annotation -revision SHA [-custom] [-accept-retag]
//	go run ./cmd/ecrtag lambda -repository R -tag T -revision SHA [-built] [-custom]
//
// published prints "true" when the tag is already there for this commit (skip
// the push) and "false" when it is not there (push it); any other state fails.
// lambda gives a Lambda image the tag (see tools/ecrtag.Lambda). -registry is
// the registry host; -accept-retag and lambda read git history from the
// working directory.
//
// Spec: specs/ci/publish-ecr-images.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const ancestorScript = ".github/scripts/nearest-ancestor-tag.sh"

type options struct {
	repository, tag, source, revision, host, head string
	custom, built, acceptRetag                    bool
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	opts, err := parse(os.Args[1], os.Args[2:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "ecrtag:", err)
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	err = run(ctx, os.Args[1], opts)
	cancel()
	if err != nil {
		fmt.Fprintf(os.Stderr, "::error::%v\n", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: ecrtag published|lambda -repository R -tag T -revision SHA [flags]")
	os.Exit(2)
}

func parse(command string, args []string) (options, error) {
	var o options
	fs := flag.NewFlagSet(command, flag.ContinueOnError)
	fs.StringVar(&o.repository, "repository", "", "ECR repository name")
	fs.StringVar(&o.tag, "tag", "", "the tag to check or publish")
	fs.StringVar(&o.source, "source", string(ecrtag.Label), "where the tag records its commit: label or annotation")
	fs.StringVar(&o.revision, "revision", "", "full sha of the commit being published")
	fs.StringVar(&o.host, "registry", os.Getenv("REGISTRY"), "registry host")
	fs.StringVar(&o.head, "head", "", "the commit whose history a re-tag reads (default -revision)")
	fs.BoolVar(&o.custom, "custom", false, "the tag is a dispatcher's, not the default commit tag")
	fs.BoolVar(&o.built, "built", false, "lambda: this run rebuilt the image and pushed the tag itself")
	fs.BoolVar(&o.acceptRetag, "accept-retag", false, "published: a tag naming the image a re-tag would copy counts as this commit's")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	if o.repository == "" || o.tag == "" || o.revision == "" {
		return o, fmt.Errorf("%s: -repository, -tag and -revision are required", command)
	}
	if o.head == "" {
		o.head = o.revision
	}

	return o, nil
}

func run(ctx context.Context, command string, o options) error {
	switch command {
	case "published":
		return published(ctx, o)
	case "lambda":
		return lambda(ctx, o)
	}

	return fmt.Errorf("unknown command %q; use published or lambda", command)
}

func (o options) ref() ecrtag.Ref { return ecrtag.Ref{Repository: o.repository, Tag: o.tag} }

func (o options) registry() ecrtag.CLI { return ecrtag.CLI{Host: o.host, Run: ecrtag.Run} }

func ancestry() ecrtag.Script { return ecrtag.Script{Path: ancestorScript, Run: ecrtag.Run} }

func published(ctx context.Context, o options) error {
	reg := o.registry()
	c := ecrtag.Check{Ref: o.ref(), Source: ecrtag.Source(o.source), Revision: o.revision, Custom: o.custom}
	if o.acceptRetag {
		_, digest, err := ecrtag.Retag{Registry: reg, Ancestry: ancestry(), Ref: o.ref(), Head: o.head}.Source(ctx)
		if err != nil {
			return err
		}
		c.AcceptDigest = digest
	}
	done, err := ecrtag.Published(ctx, reg, c)
	if err != nil {
		return err
	}
	fmt.Println(done)

	return nil
}

func lambda(ctx context.Context, o options) error {
	l := ecrtag.Lambda{
		Registry: o.registry(), Ancestry: ancestry(), Ref: o.ref(),
		Head: o.head, Revision: o.revision, Built: o.built, Custom: o.custom, Log: os.Stdout,
	}
	written, err := l.Publish(ctx)
	if err != nil || !written {
		return err
	}
	fmt.Printf("Published %s with tags: %s\n", o.repository, o.tag)
	if path := os.Getenv("GITHUB_STEP_SUMMARY"); path != "" {
		return appendSummary(path, fmt.Sprintf("Published %#q to ECR with tags: %s\n", o.repository, o.tag))
	}

	return nil
}

func appendSummary(path, line string) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600) //nolint:gosec // G703: the runner's own GITHUB_STEP_SUMMARY path
	if err != nil {
		return err
	}
	if _, err := f.WriteString(line); err != nil {
		_ = f.Close()
		return err
	}

	return f.Close()
}
