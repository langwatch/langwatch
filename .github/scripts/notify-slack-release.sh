#!/bin/bash

# Usage: notify-slack-release.sh <changelog_path> <component_name> <version>
# Example: notify-slack-release.sh sdks/python/CHANGELOG.md "Python SDK" "0.4.2"

set -e

CHANGELOG_PATH=$1
COMPONENT_NAME=$2
VERSION=$3

# Check if webhook URL is set
if [ -z "$SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL" ]; then
  echo "⚠️  SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL not set, skipping Slack notification"
  exit 0
fi

SLACK_WEBHOOK_URL="$SLACK_RELEASE_NOTIFICATION_WEBHOOK_URL"

# Array of motivational messages
MOTIVATIONAL_MESSAGES=(
  "🚀 Another one bites the dust! Ship it!"
  "🎉 Hot off the press! Fresh code incoming!"
  "✨ Magic happens when you ship! Here we go!"
  "🔥 Deploy day is the best day! Let's gooo!"
  "💪 Crushing it! Another release in the books!"
  "🎯 Bullseye! Another successful release!"
  "⚡️ Lightning fast! New version deployed!"
  "🌟 Shining bright with this new release!"
  "🎊 Party time! New features just dropped!"
  "🏆 Champion move! Release successful!"
  "🚢 All aboard the release train! Choo choo!"
  "🎪 Step right up! Fresh updates are here!"
  "🦄 Magical release incoming! Believe it!"
  "🌈 Painting the town with new features!"
  "🎨 A masterpiece of code! Released!"
)

# Pick a random motivational message
RANDOM_INDEX=$((RANDOM % ${#MOTIVATIONAL_MESSAGES[@]}))
MOTIVATIONAL_MESSAGE="${MOTIVATIONAL_MESSAGES[$RANDOM_INDEX]}"

# Extract the changelog entry for the specified version
# Using awk to find the version header and extract until next ##
CHANGELOG_CONTENT=$(awk -v version="$VERSION" '
  /^## / {
    # Check if this line contains our version
    if ($0 ~ "\\[" version "\\]") {
      found=1;
      next;
    }
    # If we already found our version, stop at the next ##
    if (found) exit;
  }
  found { print }
' "$CHANGELOG_PATH")

# Remove leading/trailing empty lines (portable way)
CHANGELOG_CONTENT=$(echo "$CHANGELOG_CONTENT" | sed '/./,$!d' | awk 'NF {p=1} p')

# Transform changelog for Slack formatting
CHANGELOG_CONTENT=$(echo "$CHANGELOG_CONTENT" | sed \
  -e 's/^### Features$/✨ Features/' \
  -e 's/^### Bug Fixes$/🐛 Bug Fixes/' \
  -e 's/^### Miscellaneous$/📦 Miscellaneous/' \
  -e 's/^### Documentation$/📚 Documentation/' \
  -e 's/^### Code Refactoring$/♻️ Code Refactoring/' \
  -e 's/^### Performance Improvements$/⚡️ Performance Improvements/' \
  -e 's/^### Tests$/✅ Tests/' \
  -e 's/^\* /• /' \
  | sed -E 's/ \(\[#[0-9]+\]\(([^)]+)\)\)/: \1/g' \
  | sed -E 's/ \(\[[0-9a-f]+\]\([^)]+\)\)//g')

# Escape special characters for JSON
CHANGELOG_JSON=$(echo "$CHANGELOG_CONTENT" | jq -Rs .)

# Create the Slack message with blocks for better formatting
MESSAGE=$(cat <<EOF
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "$MOTIVATIONAL_MESSAGE",
        "emoji": true
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*$COMPONENT_NAME v$VERSION* has been released! 🎉"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": $CHANGELOG_JSON
      }
    },
    {
      "type": "divider"
    }
  ]
}
EOF
)

# Send to Slack
curl -X POST \
  -H 'Content-type: application/json' \
  --data "$MESSAGE" \
  "$SLACK_WEBHOOK_URL"

echo "✅ Slack notification sent successfully!"
