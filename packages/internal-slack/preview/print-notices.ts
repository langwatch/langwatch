import { nowInstant } from "@langwatch/time";

import { slackNotices } from "../src/templates/index.ts";

/**
 * Prints every fixture of every notice (or of the ids given) as the JSON an
 * incoming webhook posts, with a Block Kit Builder link that renders it.
 */
const wanted = new Set(process.argv.slice(2));
const origin = {
  environment: "preview.langwatch.localhost",
  sentAt: nowInstant().epochMilliseconds,
};

for (const notice of slackNotices) {
  if (wanted.size > 0 && !wanted.has(notice.id)) continue;
  for (const fixture of notice.fixtures) {
    const message = notice.renderUnknown({ props: fixture.props, origin });
    const builder = `https://app.slack.com/block-kit-builder#${encodeURIComponent(JSON.stringify({ blocks: message.blocks }))}`;
    process.stdout.write(
      `\n## ${notice.id} / ${fixture.name}\n${notice.sentWhen}\n\n${JSON.stringify(message, null, 2)}\n\n${builder}\n`,
    );
  }
}
