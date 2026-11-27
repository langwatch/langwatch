// Command docsdeploy publishes the docs build's redirects into the docs
// distribution's key value store, and tells IndexNow which pages a deploy
// changed, for docs-site.yml's deploy job.
//
// Usage:
//
//	go run ./cmd/docsdeploy redirects -kvs-arn ARN -file apps/docs/dist/redirects.json
//	go run ./cmd/docsdeploy indexnow -live live-sitemap.xml -sitemap apps/docs/dist/sitemap.xml -key-file apps/docs/dist/indexnow.txt
//
// Spec: specs/ci/docs-deploy.feature
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/docsdeploy"
)

const usage = "usage: docsdeploy redirects -kvs-arn ARN -file redirects.json\n" +
	"       docsdeploy indexnow -live live-sitemap.xml -sitemap sitemap.xml -key-file indexnow.txt"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "redirects":
		err = redirectsCommand(os.Args[2:])
	case "indexnow":
		err = indexNowCommand(os.Args[2:])
	default:
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "::error::%v\n", err)
		os.Exit(1)
	}
}

func redirectsCommand(args []string) error {
	fs := flag.NewFlagSet("redirects", flag.ExitOnError)
	arn := fs.String("kvs-arn", "", "ARN of the docs redirect key value store")
	file := fs.String("file", "", "the build's redirects.json")
	_ = fs.Parse(args)
	if *arn == "" || *file == "" {
		return errors.New("docsdeploy redirects: -kvs-arn and -file are required")
	}
	raw, err := os.ReadFile(*file)
	if err != nil {
		return err
	}
	items, err := docsdeploy.Items(raw)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	publisher := docsdeploy.Publisher{Store: docsdeploy.CLI{ARN: *arn, Run: docsdeploy.Run}, Log: os.Stdout}

	return publisher.Publish(ctx, items)
}

// indexNowCommand submits the pages the built sitemap adds or redates
// against the live one. The key file sits in the build at /docs/indexnow.txt.
func indexNowCommand(args []string) error {
	fs := flag.NewFlagSet("indexnow", flag.ExitOnError)
	live := fs.String("live", "", "the sitemap the site served before this deploy (may be absent)")
	built := fs.String("sitemap", "", "the build's sitemap.xml")
	keyFile := fs.String("key-file", "", "the build's IndexNow key file")
	keyLocation := fs.String("key-location", "https://langwatch.ai/docs/indexnow.txt", "where the key file is served")
	_ = fs.Parse(args)
	if *built == "" || *keyFile == "" {
		return errors.New("docsdeploy indexnow: -sitemap and -key-file are required")
	}
	before, _ := os.ReadFile(*live) // absent on a first deploy: every page is new
	after, err := os.ReadFile(*built)
	if err != nil {
		return err
	}
	key, err := os.ReadFile(*keyFile)
	if err != nil {
		return err
	}
	pages, err := docsdeploy.ChangedPages(before, after)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	n := docsdeploy.IndexNow{
		Endpoint:    docsdeploy.IndexNowEndpoint,
		Key:         strings.TrimSpace(string(key)),
		KeyLocation: *keyLocation,
		Client:      &http.Client{Timeout: time.Minute},
	}
	if err := n.Submit(ctx, pages); err != nil {
		return err
	}
	fmt.Printf("IndexNow: %d changed pages submitted\n", len(pages))

	return nil
}
