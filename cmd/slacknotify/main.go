// Command slacknotify posts a CI job's failure on main to Slack, unless the
// same job was already red in the previous finished run.
//
// Usage:
//
//	go run ./cmd/slacknotify -workflow langwatch-app-ci.yml -job "package-suites (1/1)"
//
// It reads GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA, GH_TOKEN,
// SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL, COMMIT_SUBJECT and COMMIT_AUTHOR.
//
// Spec: specs/ci/package-suite-integration-lane.feature
package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/slacknotify"
)

func main() {
	workflow := flag.String("workflow", "", "workflow file name, e.g. langwatch-app-ci.yml")
	job := flag.String("job", "", "the failed job's display name")
	flag.Parse()
	if *workflow == "" || *job == "" {
		fmt.Fprintln(os.Stderr, "slacknotify: -workflow and -job are required")
		os.Exit(2)
	}
	runID, err := strconv.ParseInt(os.Getenv("GITHUB_RUN_ID"), 10, 64)
	if err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify: GITHUB_RUN_ID is not a run id")
		os.Exit(2)
	}
	n := slacknotify.Notifier{
		API:     "https://api.github.com",
		Token:   os.Getenv("GH_TOKEN"),
		Webhook: os.Getenv("SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL"),
		HTTP:    &http.Client{Timeout: 20 * time.Second},
	}
	subject, _, _ := strings.Cut(os.Getenv("COMMIT_SUBJECT"), "\n")
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	result, err := n.Notify(ctx, slacknotify.Run{
		Repository: os.Getenv("GITHUB_REPOSITORY"), Workflow: *workflow, RunID: runID, Job: *job,
		SHA: os.Getenv("GITHUB_SHA"), Subject: subject, Author: os.Getenv("COMMIT_AUTHOR"),
	})
	cancel()
	if err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify:", err)
		os.Exit(1)
	}
	fmt.Printf("slacknotify: posted=%t (%s)\n", result.Posted, result.Reason)
}
