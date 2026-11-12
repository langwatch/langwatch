// Command waitforchecks blocks until every other check run on a commit has
// finished and none failed, for the review job of pr.yml.
//
// Usage:
//
//	go run ./cmd/waitforchecks
//
// It reads GITHUB_REPOSITORY, SHA and GH_TOKEN, and the name of the check to
// ignore (the caller's own) from EXCLUDE_CHECK.
//
// Spec: specs/ci/pr-review-bot.feature
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/waitforchecks"
)

func main() {
	w := waitforchecks.Waiter{
		API:        "https://api.github.com",
		Repository: os.Getenv("GITHUB_REPOSITORY"),
		SHA:        os.Getenv("SHA"),
		Token:      os.Getenv("GH_TOKEN"),
		Exclude:    os.Getenv("EXCLUDE_CHECK"),
		HTTP:       &http.Client{Timeout: 30 * time.Second},
		Interval:   30 * time.Second,
		Timeout:    45 * time.Minute,
		Log:        os.Stdout,
	}
	if w.Repository == "" || w.SHA == "" || w.Token == "" {
		fmt.Fprintln(os.Stderr, "waitforchecks: GITHUB_REPOSITORY, SHA and GH_TOKEN are required")
		os.Exit(2)
	}
	if err := w.Wait(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "::error::%v\n", err)
		os.Exit(1)
	}
}
