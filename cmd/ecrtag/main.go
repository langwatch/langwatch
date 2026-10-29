// Command ecrtag checks and writes image tags in the artifacts ECR, whose tags
// are immutable, for publish-docker-ecr.yml and publish-docker-private.yml.
//
// Usage:
//
//	go run ./cmd/ecrtag published -repository R -tag T -source label|annotation -revision SHA [-custom] [-refuse-retag] [-built-from TAG]
//	go run ./cmd/ecrtag lambda -repository R -tag T -revision SHA [-built] [-custom]
//	go run ./cmd/ecrtag select -images JSON -tag T -revision SHA [-all] [-custom]
//
// published prints "true" when the tag is already there for this commit (skip
// the push) and "false" when it is not there (push it); any other state fails.
// lambda gives a Lambda image the tag (see tools/ecrtag.Lambda). select reads
// -images, a JSON array of {"image", "dockerfile"}, and prints one
// tools/ecrtag.Plan per image: its inputs hash, and whether to build it or
// re-tag the image of the nearest ancestor (tools/ecrtag.Select); -all builds
// every image, as a dispatch does, and reads no registry. -registry is the
// registry host; -refuse-retag, lambda and select read the first-parent git
// history from the working directory, and select reads the checkout of
// -revision there. -refuse-retag fails on a tag naming the image a push
// run's re-tag would copy; -built-from is the per-arch tag an index must name.
//
// Spec: specs/ci/publish-ecr-images.feature
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const ancestorScript = ".github/scripts/nearest-ancestor-tag.sh"

type options struct {
	repository, tag, source, revision, host, head, builtFrom string
	images                                                   []ecrtag.ImageSpec
	custom, built, refuseRetag, all                          bool
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
	fmt.Fprintln(os.Stderr, "usage: ecrtag published|lambda|select -repository R -tag T -revision SHA [flags]")
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
	fs.BoolVar(&o.refuseRetag, "refuse-retag", false, "published: fail on a tag naming the image a re-tag would copy")
	fs.StringVar(&o.builtFrom, "built-from", "", "published: the per-arch tag this run built, which an index tag must name")
	images := fs.String("images", "", `select: a JSON array of {"image", "dockerfile"}`)
	fs.BoolVar(&o.all, "all", false, "select: build every image, as a dispatch does")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	if command == "select" {
		return o, selectOptions(&o, *images)
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
	case "select":
		return selectImages(ctx, o)
	}

	return fmt.Errorf("unknown command %q; use published, lambda or select", command)
}

func (o options) ref() ecrtag.Ref { return ecrtag.Ref{Repository: o.repository, Tag: o.tag} }

// check is the Check published asks about. A Check never accepts a re-tag
// here: only the Lambda re-tag itself does (tools/ecrtag.Lambda).
func (o options) check(ctx context.Context, reg ecrtag.Registry, anc ecrtag.Ancestry) (ecrtag.Check, error) {
	c := ecrtag.Check{Ref: o.ref(), Source: ecrtag.Source(o.source), Revision: o.revision, Custom: o.custom, BuiltFrom: o.builtFrom}
	if o.refuseRetag {
		_, digest, err := ecrtag.Retag{Registry: reg, Ancestry: anc, Ref: o.ref(), Head: o.head}.Source(ctx)
		if err != nil {
			return c, err
		}
		c.RefuseDigest = digest
	}

	return c, nil
}

func (o options) registry() ecrtag.CLI { return ecrtag.CLI{Host: o.host, Run: ecrtag.Run} }

func ancestry() ecrtag.Script { return ecrtag.Script{Path: ancestorScript, Run: ecrtag.Run} }

func published(ctx context.Context, o options) error {
	reg := o.registry()
	c, err := o.check(ctx, reg, ancestry())
	if err != nil {
		return err
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

// selectOptions reads -images. A custom tag is a dispatch, which builds
// every image; a run with no -all needs the commit tag it publishes and the
// commit, to find what a re-tag would copy.
func selectOptions(o *options, images string) error {
	o.all = o.all || o.custom
	if err := json.Unmarshal([]byte(images), &o.images); err != nil {
		return fmt.Errorf("select: -images: %w", err)
	}
	if len(o.images) == 0 {
		return errors.New("select: -images names no image")
	}
	for _, img := range o.images {
		if img.Image == "" || img.Dockerfile == "" {
			return fmt.Errorf("select: image %+v needs an image and a dockerfile", img)
		}
	}
	if o.revision == "" || (!o.all && o.tag == "") {
		return errors.New("select: -revision, and -tag unless -all, are required")
	}
	if o.head == "" {
		o.head = o.revision
	}

	return nil
}

func selectImages(ctx context.Context, o options) error {
	tree, err := ecrtag.GitTree(ctx, ecrtag.Run, ".", o.revision)
	if err != nil {
		return err
	}
	plans, err := ecrtag.Select{
		Registry: o.registry(), Ancestry: ancestry(),
		Inputs: ecrtag.Inputs{Tree: tree, Read: ecrtag.ReadFile("."), GoDeps: ecrtag.GoList(ecrtag.Run, ".")},
		Tag:    o.tag, Head: o.head, All: o.all,
	}.Plan(ctx, o.images)
	if err != nil {
		return err
	}
	for _, p := range plans {
		verb := "re-tag"
		if p.Build {
			verb = "build"
		}
		if p.Inputs == "" {
			fmt.Fprintf(os.Stderr, "::warning::%s: %s; building it\n", p.Image, p.Reason)
		}
		fmt.Fprintf(os.Stderr, "%s: %s, %s\n", p.Image, verb, p.Reason)
	}
	out, err := json.Marshal(plans)
	if err != nil {
		return err
	}
	fmt.Println(string(out))

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
