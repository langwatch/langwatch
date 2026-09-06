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

# Slack caps a section's text at 3000 characters and rejects the whole
# payload as invalid_blocks past it, so split the changelog into chunks and
# give each chunk its own section block. Chunks break at line boundaries,
# and a single line longer than the cap is cut into pieces so it cannot
# escape the limit on its own. The 2900 target leaves 100 characters of
# margin, which absorbs the few emoji that count as more than one character.
# jq measures and slices strings in characters, not bytes, which is what
# Slack counts.
CHUNKS_JSON=$(printf '%s' "$CHANGELOG_CONTENT" | jq -Rs --argjson max 2900 '
  def split_long($max):
    if length <= $max then [.] else [.[0:$max]] + (.[$max:] | split_long($max)) end;

  sub("\n+$"; "")
  | split("\n")
  | map(split_long($max))
  | (add // [])
  | reduce .[] as $line ([];
      if length == 0 then [$line]
      elif ((.[-1] | length) + 1 + ($line | length)) > $max then . + [$line]
      else .[0:-1] + [.[-1] + "\n" + $line] end)
  | map(select(length > 0))')

RELEASES_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-langwatch/langwatch}/releases"

MESSAGE=$(jq -n \
  --arg header "$MOTIVATIONAL_MESSAGE" \
  --arg intro "*$COMPONENT_NAME v$VERSION* has been released! 🎉" \
  --arg releases_url "$RELEASES_URL" \
  --argjson chunks "$CHUNKS_JSON" \
  '{blocks: ([
      {type: "header", text: {type: "plain_text", text: $header, emoji: true}},
      {type: "section", text: {type: "mrkdwn", text: $intro}}
    ]
    + ($chunks[0:4] | map({type: "section", text: {type: "mrkdwn", text: .}}))
    + (if ($chunks | length) > 4 then
        [{type: "section", text: {type: "mrkdwn", text: ("_Changelog truncated. Full notes: " + $releases_url + "_")}}]
      else [] end)
    + [{type: "divider"}])}')

# Send to Slack. The webhook answers 200 "ok" on success and an error string
# such as invalid_blocks otherwise, so the body is the success signal. The
# timeouts keep a stalled webhook from holding the release job open until the
# runner limit.
RESPONSE=$(curl -sS -X POST \
  --connect-timeout 10 \
  --max-time 30 \
  -H 'Content-type: application/json' \
  --data "$MESSAGE" \
  "$SLACK_WEBHOOK_URL")

if [ "$RESPONSE" != "ok" ]; then
  echo "❌ Slack rejected the notification: $RESPONSE"
  exit 1
fi

echo "✅ Slack notification sent successfully!"
