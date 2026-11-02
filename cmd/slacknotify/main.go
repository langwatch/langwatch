// Command slacknotify posts a CI job's failure on main to Slack, unless the
// same job was already red in the previous finished run.
//
// Usage:
//
//	go run ./cmd/slacknotify -job typecheck
//	go run ./cmd/slacknotify -job-prefix "package-suites (" -fallback-job "package-suites (1/1)"
//
// -job-prefix posts once per job of this run attempt (GITHUB_RUN_ATTEMPT) that
// carries the prefix and failed or was cancelled; with none, or a failed
// lookup, it posts as -fallback-job.
// -workflow defaults to the running workflow's file, from GITHUB_WORKFLOW_REF.
// COMMIT_SUBJECT and COMMIT_AUTHOR come from a push event; any other event
// falls back to the checked-out commit.
// It reads GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_SHA, GH_TOKEN,
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
	workflow := flag.String("workflow", slacknotify.WorkflowFile(os.Getenv("GITHUB_WORKFLOW_REF")), "workflow file name, e.g. langwatch-app-ci.yml")
	job := flag.String("job", "", "the failed job's display name")
	prefix := flag.String("job-prefix", "", "post once per red job of this run attempt named with this prefix")
	fallback := flag.String("fallback-job", "", "with -job-prefix: the job to post as when no red job is found")
	flag.Parse()
	if *workflow == "" || (*job == "") == (*prefix == "") || (*prefix == "") != (*fallback == "") {
		fmt.Fprintln(os.Stderr, "slacknotify: -workflow and either -job or -job-prefix with -fallback-job are required")
		os.Exit(2)
	}
	runID, err := strconv.ParseInt(os.Getenv("GITHUB_RUN_ID"), 10, 64)
	if err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify: GITHUB_RUN_ID is not a run id")
		os.Exit(2)
	}
	legs := slacknotify.Legs{Prefix: *prefix, Fallback: *fallback}
	if legs.Prefix != "" {
		if legs.Attempt, err = strconv.ParseInt(os.Getenv("GITHUB_RUN_ATTEMPT"), 10, 64); err != nil {
			fmt.Fprintln(os.Stderr, "slacknotify: GITHUB_RUN_ATTEMPT is not a run attempt")
			os.Exit(2)
		}
	}
	n := slacknotify.Notifier{
		API:     "https://api.github.com",
		Token:   os.Getenv("GH_TOKEN"),
		Webhook: os.Getenv("SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL"),
		HTTP:    &http.Client{Timeout: 20 * time.Second},
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	subject, _, _ := strings.Cut(slacknotify.Checkout{Dir: "."}.Or(ctx, os.Getenv("COMMIT_SUBJECT"), "%s"), "\n")
	run := slacknotify.Run{
		Repository: os.Getenv("GITHUB_REPOSITORY"), Workflow: *workflow, RunID: runID, Job: *job,
		SHA: os.Getenv("GITHUB_SHA"), Subject: subject, Author: slacknotify.Checkout{Dir: "."}.Or(ctx, os.Getenv("COMMIT_AUTHOR"), "%an"),
	}
	results, err := notify(ctx, n, run, legs)
	cancel()
	for _, result := range results {
		fmt.Printf("slacknotify: %s posted=%t (%s)\n", result.Job, result.Posted, result.Reason)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify:", err)
		os.Exit(1)
	}
}

// notify posts for run.Job, or with legs.Prefix set for each red leg.
func notify(ctx context.Context, n slacknotify.Notifier, run slacknotify.Run, legs slacknotify.Legs) ([]slacknotify.Result, error) {
	if legs.Prefix != "" {
		return n.NotifyRedLegs(ctx, run, legs)
	}
	result, err := n.Notify(ctx, run)
	if err != nil {
		return nil, err
	}

	return []slacknotify.Result{result}, nil
}
