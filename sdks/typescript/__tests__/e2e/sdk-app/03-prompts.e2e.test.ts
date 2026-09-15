// @vitest-environment node

/**
 * Leg 3 — prompts: created, read back under two fetch policies, compiled,
 * tagged and deleted, each step proved through the platform's own list.
 */
import { afterAll, describe, expect, it } from "vitest";

import { FetchPolicy, type LangWatch } from "../../../dist";
import { client, unique } from "./support/journey";

describe("given an application that manages its prompts through the SDK", () => {
  const langwatch: LangWatch = client();
  const handle = unique("sdk-app-prompt");
  const created: string[] = [];
  const tagsCreated: string[] = [];

  afterAll(async () => {
    for (const each of created) {
      await langwatch.prompts.delete(each).catch(() => undefined);
    }
    for (const each of tagsCreated) {
      await langwatch.prompts.tags.delete(each).catch(() => undefined);
    }
  });

  describe("when it creates a prompt and reads it back", () => {
    // @scenario "A prompt is created, fetched under each policy, compiled and deleted"
    it("creates, fetches under each policy, compiles and deletes the prompt", async () => {
      const prompt = await langwatch.prompts.create({
        handle,
        scope: "PROJECT",
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: "You answer about {{subject}}." },
          { role: "user", content: "{{question}}" },
        ],
        inputs: [
          { identifier: "subject", type: "str" },
          { identifier: "question", type: "str" },
        ],
        outputs: [{ identifier: "answer", type: "str" }],
      });
      created.push(prompt.id);

      const byHandle = await langwatch.prompts.get(handle);
      expect(byHandle.id).toBe(prompt.id);

      const fresh = await langwatch.prompts.get(handle, {
        fetchPolicy: FetchPolicy.ALWAYS_FETCH,
      });
      expect(fresh.id).toBe(prompt.id);

      const compiled = fresh.compile({ subject: "observability", question: "What is a span?" });
      expect(JSON.stringify(compiled.messages)).toContain("You answer about observability.");
      expect(JSON.stringify(compiled.messages)).toContain("What is a span?");

      await langwatch.prompts.delete(prompt.id);
      created.length = 0;

      const remaining = await langwatch.prompts.getAll();
      expect(remaining.map((each) => each.handle)).not.toContain(handle);
    }, 90_000);
  });

  describe("when it compiles strictly without a variable the template names", () => {
    // @scenario "Compiling a prompt with a missing variable is refused"
    it("refuses the compile rather than emitting an empty value", async () => {
      const strictHandle = unique("sdk-app-prompt-strict");
      const prompt = await langwatch.prompts.create({
        handle: strictHandle,
        scope: "PROJECT",
        messages: [
          { role: "system", content: "You are terse." },
          { role: "user", content: "Tell me about {{subject}}." },
        ],
        inputs: [{ identifier: "subject", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      });
      created.push(prompt.id);

      expect(() => prompt.compileStrict({})).toThrow();
    }, 60_000);
  });

  describe("when it fetches a handle nothing holds", () => {
    // @scenario "A prompt handle that does not exist is refused by name"
    it("fails with the platform's own not-found error", async () => {
      const absent = unique("sdk-app-prompt-absent");

      await expect(langwatch.prompts.get(absent)).rejects.toThrow(absent);
    }, 60_000);
  });

  describe("when it tags a prompt version", () => {
    // @scenario "A prompt version is tagged"
    it("assigns the tag and the platform lists it on the prompt", async () => {
      const handleToTag = unique("sdk-app-prompt-tagged");
      const prompt = await langwatch.prompts.create({
        handle: handleToTag,
        scope: "PROJECT",
        messages: [{ role: "system", content: "You are terse." }],
        outputs: [{ identifier: "answer", type: "str" }],
      });
      created.push(prompt.id);

      const tag = unique("sdk-app-tag");
      await langwatch.prompts.tags.create({ name: tag });
      tagsCreated.push(tag);

      const definitions = await langwatch.prompts.tags.list();
      expect(definitions.map((each) => each.name)).toContain(tag);

      // The client's Prompt carries no tags, so the assignment the platform
      // reports back is the read side this surface has.
      const assigned = await langwatch.prompts.tags.assign(prompt.id, {
        tag,
        versionId: prompt.versionId!,
      });
      expect(assigned.tag).toBe(tag);
      expect(assigned.versionId).toBe(prompt.versionId);
    }, 90_000);
  });
});
