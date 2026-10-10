/**
 * @vitest-environment node
 * Which changelog entry each person last opened.
 * @see modules/navigation/specs/whats-new.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryUserChangelogChannel } from "../../channels/memory/memory.user-changelog.channel.ts";
import { createUserTestApp } from "./user.fixture.ts";

const entry = (id: string) => ({
  id,
  title: `Entry ${id}`,
  url: `https://langwatch.ai/changelog/${id}`,
  publishedAt: "",
  imageUrl: null,
  features: [],
});

async function personWith(entries: ReturnType<typeof entry>[]) {
  const changelog = MemoryUserChangelogChannel.create({ entries });
  const app = createUserTestApp({ changelog });
  const user = await app.create({ email: "jane@acme.test", name: "Jane" });
  return { app, id: user.id };
}

describe("What's new seen state", () => {
  /** @scenario "An unseen entry carries a dot until the card is opened" */
  it("marks the latest entry unseen until it is opened", async () => {
    const { app, id } = await personWith([entry("week-40")]);
    expect((await app.findWhatsNew({ id }))[0]?.seen).toBe(false);

    await app.markWhatsNewSeen({ id, entryId: "week-40" });

    expect((await app.findWhatsNew({ id }))[0]?.seen).toBe(true);
  });

  /** @scenario "A newer entry brings the dot back" */
  it("shows a newer entry as unseen after an older one was opened", async () => {
    const { app, id } = await personWith([entry("week-41")]);
    await app.markWhatsNewSeen({ id, entryId: "week-40" });

    expect((await app.findWhatsNew({ id }))[0]?.seen).toBe(false);
  });

  it("answers no entries when the changelog has none", async () => {
    const { app, id } = await personWith([]);
    expect(await app.findWhatsNew({ id })).toEqual([]);
  });
});
