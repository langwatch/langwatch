#!/bin/bash

# Notify Slack when a CI job fails on main (only on NEW failures)
# Usage: notify-slack-job-failure.sh <job_name>
# Example: notify-slack-job-failure.sh typecheck
#
# Requires: GH_TOKEN env var for checking previous run status

set -e

JOB_NAME=${1:-"job"}

# Check if webhook URL is set
if [ -z "$SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL" ]; then
  echo "⚠️  SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL not set, skipping Slack notification"
  exit 0
fi

# Check if this is a NEW failure by looking at the previous main run
if [ -n "$GH_TOKEN" ]; then
  echo "Checking if this is a new failure..."

  # Get the previous run (second most recent failure for this workflow on main)
  PREVIOUS_RUN_ID=$(gh run list --branch main --status failure --workflow "$GITHUB_WORKFLOW" --limit 2 --json databaseId --jq '.[1].databaseId // empty')

  if [ -n "$PREVIOUS_RUN_ID" ]; then
    # Check if the same job failed in the previous run
    PREVIOUS_JOB_FAILED=$(gh run view "$PREVIOUS_RUN_ID" --json jobs --jq ".jobs[] | select(.name == \"$JOB_NAME\" and .conclusion == \"failure\") | .name" 2>/dev/null || echo "")

    if [ -n "$PREVIOUS_JOB_FAILED" ]; then
      echo "Job '$JOB_NAME' also failed in previous run $PREVIOUS_RUN_ID, skipping notification"
      exit 0
    fi
  fi

  echo "New failure detected for job: $JOB_NAME"
else
  echo "⚠️  GH_TOKEN not set, skipping repeat-failure check"
fi

echo "Sending Slack notification for failed job: $JOB_NAME"

# Get the commit info
COMMIT_SHA="${GITHUB_SHA:0:7}"
COMMIT_MSG=$(git log -1 --pretty=format:'%s' 2>/dev/null || echo "Unknown commit")
COMMIT_AUTHOR=$(git log -1 --pretty=format:'%an' 2>/dev/null || echo "Unknown")
RUN_URL="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

# Create the Slack message with proper JSON escaping via jq
SECTION_TEXT=$(printf '*Job:* %s\n*Commit:* `%s` - %s\n*Author:* %s' "$JOB_NAME" "$COMMIT_SHA" "$COMMIT_MSG" "$COMMIT_AUTHOR")

MESSAGE=$(jq -n \
  --arg section_text "$SECTION_TEXT" \
  --arg run_url "$RUN_URL" \
  '{
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚨 CI Job Failed on main",
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: $section_text
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Run",
              emoji: true
            },
            url: $run_url
          }
        ]
      }
    ]
  }')

# Send to Slack
curl -f -X POST \
  -H 'Content-type: application/json' \
  --data "$MESSAGE" \
  "$SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL"

echo "✅ Slack notification sent!"
