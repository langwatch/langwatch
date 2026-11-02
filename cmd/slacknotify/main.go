// Command slacknotify posts a CI job's failure on main to Slack, unless that job
// was already red in the previous finished run: `-job typecheck`, or one post per
// red leg with `-job-prefix "package-suites (" -fallback-job "package-suites (1/1)"`.
// Inputs: the flags (see -help) and the GITHUB_*, GH_TOKEN, COMMIT_* and Slack env.
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
		// A bad attempt leaves 0: the lookup fails and the fallback leg still posts.
		legs.Attempt, _ = strconv.ParseInt(os.Getenv("GITHUB_RUN_ATTEMPT"), 10, 64)
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
	cancel()
	// NotifyRedLegs times each leg itself; one -job keeps the one minute.
	results, err := notify(n, run, legs)
	for _, result := range results {
		fmt.Printf("slacknotify: %s posted=%t (%s)\n", result.Job, result.Posted, result.Reason)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "slacknotify:", err)
		os.Exit(1)
	}
}

// notify posts for run.Job, or with legs.Prefix set for each red leg.
func notify(n slacknotify.Notifier, run slacknotify.Run, legs slacknotify.Legs) ([]slacknotify.Result, error) {
	if legs.Prefix != "" {
		return n.NotifyRedLegs(context.Background(), run, legs)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	result, err := n.Notify(ctx, run)
	if err != nil {
		return nil, err
	}

	return []slacknotify.Result{result}, nil
}
