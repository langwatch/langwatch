// Command docsdeploy publishes the docs build's redirects into the docs
// distribution's key value store, for docs-site.yml's deploy job.
//
// Usage:
//
//	go run ./cmd/docsdeploy redirects -kvs-arn ARN -file apps/docs/dist/redirects.json
//
// Spec: specs/ci/docs-deploy.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/docsdeploy"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "redirects" {
		fmt.Fprintln(os.Stderr, "usage: docsdeploy redirects -kvs-arn ARN -file redirects.json")
		os.Exit(2)
	}
	fs := flag.NewFlagSet("redirects", flag.ExitOnError)
	arn := fs.String("kvs-arn", "", "ARN of the docs redirect key value store")
	file := fs.String("file", "", "the build's redirects.json")
	_ = fs.Parse(os.Args[2:])
	if *arn == "" || *file == "" {
		fmt.Fprintln(os.Stderr, "docsdeploy redirects: -kvs-arn and -file are required")
		os.Exit(2)
	}
	if err := redirects(*arn, *file); err != nil {
		fmt.Fprintf(os.Stderr, "::error::%v\n", err)
		os.Exit(1)
	}
}

func redirects(arn, file string) error {
	raw, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	items, err := docsdeploy.Items(raw)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	publisher := docsdeploy.Publisher{Store: docsdeploy.CLI{ARN: arn, Run: docsdeploy.Run}, Log: os.Stdout}

	return publisher.Publish(ctx, items)
}
