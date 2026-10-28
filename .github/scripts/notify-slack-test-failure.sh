#!/bin/bash

# Notify Slack only when there's a NEW test failure (different from previous run)
# Usage: notify-slack-test-failure.sh <job_name>
# Example: notify-slack-test-failure.sh test-unit

set -e

JOB_NAME=${1:-"test"}

# Check if webhook URL is set
if [ -z "$SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL" ]; then
  echo "⚠️  SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL not set, skipping Slack notification"
  exit 0
fi

# Get current run's failed tests from the log
CURRENT_FAILURES=$(cat test-failures.txt 2>/dev/null || echo "")

if [ -z "$CURRENT_FAILURES" ]; then
  echo "No failures file found, skipping notification"
  exit 0
fi

CURRENT_HASH=$(echo "$CURRENT_FAILURES" | sort | md5sum | cut -d' ' -f1)
echo "Current failures hash: $CURRENT_HASH"

# Get previous main run's failures
PREVIOUS_RUN_ID=$(gh run list --branch main --status failure --workflow "$GITHUB_WORKFLOW" --limit 2 --json databaseId --jq '.[1].databaseId // empty')

if [ -n "$PREVIOUS_RUN_ID" ]; then
  echo "Checking previous run: $PREVIOUS_RUN_ID"

  # Get previous run's failure log and extract test names
  PREVIOUS_FAILURES=$(gh run view "$PREVIOUS_RUN_ID" --log-failed 2>/dev/null | grep -E "FAIL |AssertionError" | head -20 || echo "")
  PREVIOUS_HASH=$(echo "$PREVIOUS_FAILURES" | sort | md5sum | cut -d' ' -f1)

  echo "Previous failures hash: $PREVIOUS_HASH"

  if [ "$CURRENT_HASH" = "$PREVIOUS_HASH" ]; then
    echo "Same failures as previous run, skipping notification"
    exit 0
  fi
fi

echo "New failure detected! Sending Slack notification..."

# Get the commit info
COMMIT_SHA="${GITHUB_SHA:0:7}"
COMMIT_MSG=$(git log -1 --pretty=format:'%s' 2>/dev/null || echo "Unknown commit")
COMMIT_AUTHOR=$(git log -1 --pretty=format:'%an' 2>/dev/null || echo "Unknown")
RUN_URL="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

# Format failures for Slack (first 5 lines)
FAILURES_PREVIEW=$(echo "$CURRENT_FAILURES" | head -5 | sed 's/"/\\"/g' | tr '\n' '|' | sed 's/|/\\n/g')

# Create the Slack message
MESSAGE=$(cat <<EOF
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🚨 New Test Failure on main",
        "emoji": true
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Job:* $JOB_NAME\n*Commit:* \`$COMMIT_SHA\` - $COMMIT_MSG\n*Author:* $COMMIT_AUTHOR"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "\`\`\`$FAILURES_PREVIEW\`\`\`"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": "View Run",
            "emoji": true
          },
          "url": "$RUN_URL"
        }
      ]
    }
  ]
}
EOF
)

# Send to Slack
curl -X POST \
  -H 'Content-type: application/json' \
  --data "$MESSAGE" \
  "$SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL"

echo "✅ Slack notification sent!"
