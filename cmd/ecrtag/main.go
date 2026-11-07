// Command ecrtag checks and writes image tags in the artifacts ECR, whose tags
// are immutable, for publish-docker-ecr.yml and publish-docker-private.yml.
//
// Usage:
//
//	go run ./cmd/ecrtag published -repository R -tag T -source label|annotation -revision SHA [-custom] [-refuse-retag] [-built-from TAG]
//	go run ./cmd/ecrtag lambda -repository R -tag T -revision SHA [-built] [-custom]
//	go run ./cmd/ecrtag diffbase -repositories "R1 R2" -tag T -revision SHA -custom=false
//	go run ./cmd/ecrtag lwql-access -repository R -tag T -custom=BOOL (-image IMAGE | -from "T1 T2")
//
// published prints "true" when the tag is already there for this commit (skip
// the push) and "false" when it is not there (push it); any other state fails.
// lambda gives a Lambda image the tag (see tools/ecrtag.Lambda). diffbase
// prints {"base": tag, "rebuild": [repository]} (tools/ecrtag.DiffBase): where
// a push run's change set starts, "" when no repository has an image to
// re-tag, and the repositories it must rebuild whatever the diff says.
// lwql-access tags T lwql-access-<fingerprint>-T and prints the fingerprint:
// rendered from -image, or copied from the first -from tag whose image has one
// (tools/ecrtag.LwqlAccessTag). -registry is
// the registry host; -refuse-retag, lambda and diffbase read the first-parent
// git history from the working directory. -refuse-retag fails on a tag naming the image a push
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
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const ancestorScript = ".github/scripts/nearest-ancestor-tag.sh"

type options struct {
	repository, tag, source, revision, host, head, builtFrom, image string
	repositories, from                                              []string
	custom, built, refuseRetag                                      bool
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
	fmt.Fprintln(os.Stderr, "usage: ecrtag published|lambda|diffbase|lwql-access -repository R -tag T [flags]")
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
	repositories := fs.String("repositories", "", "diffbase: every repository the run re-tags, space separated")
	fs.StringVar(&o.image, "image", "", "lwql-access: the image to render the access model in")
	from := fs.String("from", "", "lwql-access: tags whose image's fingerprint to copy, space separated")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	o.repositories = strings.Fields(*repositories)
	o.from = strings.Fields(*from)
	switch command {
	case "diffbase":
		return o, diffBaseOptions(o)
	case "lwql-access":
		return o, lwqlAccessOptions(o)
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
	case "diffbase":
		return diffBase(ctx, o)
	case "lwql-access":
		return lwqlAccess(ctx, o)
	}

	return fmt.Errorf("unknown command %q; use published, lambda, diffbase or lwql-access", command)
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

// diffBaseOptions: only a push run's commit tag has a change set; a custom
// tag is a dispatch, which rebuilds every image.
func diffBaseOptions(o options) error {
	if len(o.repositories) == 0 || o.tag == "" || o.revision == "" {
		return errors.New("diffbase: -repositories, -tag and -revision are required")
	}
	if o.custom {
		return errors.New("diffbase: a custom tag has no change set; a dispatch rebuilds every image")
	}

	return nil
}

func diffBase(ctx context.Context, o options) error {
	base, err := ecrtag.DiffBase{
		Registry: o.registry(), Ancestry: ancestry(), Repositories: o.repositories, Tag: o.tag, Head: o.revision,
	}.Find(ctx)
	if err != nil {
		return err
	}
	out, err := json.Marshal(base)
	if err != nil {
		return err
	}
	fmt.Println(string(out))

	return nil
}

// lwqlAccessOptions: the fingerprint comes from exactly one place.
func lwqlAccessOptions(o options) error {
	if o.repository == "" || o.tag == "" {
		return errors.New("lwql-access: -repository and -tag are required")
	}
	if (o.image == "") == (len(o.from) == 0) {
		return errors.New("lwql-access: give -image or -from, not both")
	}

	return nil
}

func lwqlAccess(ctx context.Context, o options) error {
	reg := o.registry()
	l := ecrtag.LwqlAccessTag{Registry: reg, Tags: reg, Ref: o.ref(), Sources: o.from}
	if o.image != "" {
		fingerprint, err := ecrtag.LwqlAccessFingerprint(ctx, ecrtag.Run, o.image)
		if err != nil {
			return err
		}
		l.Fingerprint = fingerprint
	}
	fingerprint, err := l.Write(ctx)
	if err != nil {
		return err
	}
	fmt.Println(fingerprint)

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
