#!/bin/bash

# Notify Slack when a CI job fails on main
# Usage: notify-slack-job-failure.sh <job_name>
# Example: notify-slack-job-failure.sh typecheck

set -e

JOB_NAME=${1:-"job"}

# Check if webhook URL is set
if [ -z "$SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL" ]; then
  echo "⚠️  SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL not set, skipping Slack notification"
  exit 0
fi

echo "Sending Slack notification for failed job: $JOB_NAME"

# Get the commit info
COMMIT_SHA="${GITHUB_SHA:0:7}"
COMMIT_MSG=$(git log -1 --pretty=format:'%s' 2>/dev/null || echo "Unknown commit")
COMMIT_AUTHOR=$(git log -1 --pretty=format:'%an' 2>/dev/null || echo "Unknown")
RUN_URL="https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

# Create the Slack message
MESSAGE=$(cat <<EOF
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🚨 CI Job Failed on main",
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
