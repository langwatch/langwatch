// Command slacknotify posts a CI job's failure on main to Slack, unless that job
// was already red in the previous finished run: `-job typecheck`, or one post per
// red leg with `-job-prefix "package-suites (" -fallback-job "package-suites (1/1)"`.
// Env: GITHUB_REPOSITORY, _RUN_ID, _RUN_ATTEMPT, _SHA, _WORKFLOW_REF (-workflow default),
// GH_TOKEN, COMMIT_*, SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL. Spec: specs/ci/package-suite-integration-lane.feature
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
	workflow := flag.String("workflow", slacknotify.WorkflowFile(os.Getenv("GITHUB_WORKFLOW_REF")), "workflow file name, e.g. langwatch-app-ci.yml")
	job := flag.String("job", "", "the failed job's display name")
	prefix := flag.String("job-prefix", "", "post once per red job of this run attempt named with this prefix")
	fallback := flag.String("fallback-job", "", "with -job-prefix: the job to post as when no red job is found")
	flag.Parse()
	mode := slacknotify.Mode{Job: *job, Legs: slacknotify.Legs{Prefix: *prefix, Fallback: *fallback}}
	if err := mode.Check(); err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify:", err)
		os.Exit(2)
	}
	if *workflow == "" {
		fmt.Fprintln(os.Stderr, "slacknotify: -workflow is required")
		os.Exit(2)
	}
	runID, err := strconv.ParseInt(os.Getenv("GITHUB_RUN_ID"), 10, 64)
	if err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify: GITHUB_RUN_ID is not a run id")
		os.Exit(2)
	}
	// A bad attempt fails the jobs lookup, and the fallback leg still posts.
	mode.Attempt, _ = strconv.ParseInt(os.Getenv("GITHUB_RUN_ATTEMPT"), 10, 64)
	n := slacknotify.Notifier{
		API:     "https://api.github.com",
		Token:   os.Getenv("GH_TOKEN"),
		Webhook: os.Getenv("SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL"),
		HTTP:    &http.Client{Timeout: 20 * time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	subject, _, _ := strings.Cut(slacknotify.Checkout{Dir: "."}.Or(ctx, os.Getenv("COMMIT_SUBJECT"), "%s"), "\n")
	run := slacknotify.Run{
		Repository: os.Getenv("GITHUB_REPOSITORY"), Workflow: *workflow, RunID: runID,
		SHA: os.Getenv("GITHUB_SHA"), Subject: subject, Author: slacknotify.Checkout{Dir: "."}.Or(ctx, os.Getenv("COMMIT_AUTHOR"), "%an"),
	}
	cancel()
	results, err := n.NotifyMode(context.Background(), run, mode)
	for _, result := range results {
		fmt.Printf("slacknotify: %s posted=%t (%s)\n", result.Job, result.Posted, result.Reason)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify:", err)
		os.Exit(1)
	}
}
