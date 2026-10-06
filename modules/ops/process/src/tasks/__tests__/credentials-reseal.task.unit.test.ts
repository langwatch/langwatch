import { randomBytes } from "node:crypto";

import { aesEncryption } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { MemoryCredentialsResealRepository } from "../../repositories/memory/memory.credentials-reseal.repository.ts";
import { resealText } from "../../rules/credentials-reseal.rules.ts";
import { CredentialsResealTask, resealCredentials } from "../credentials-reseal.task.ts";

/** @see specs/self-hosting/credentials-secret-rotation.feature */

const previous = aesEncryption(randomBytes(32));
const current = aesEncryption(randomBytes(32));
const unknown = aesEncryption(randomBytes(32));

const opensUnder = (cipher: typeof current, sealed: string): string | undefined => {
  try {
    return cipher.decrypt(sealed);
  } catch {
    return undefined;
  }
};

describe("resealText", () => {
  describe("given a JSON document holding a credential sealed under the previous key", () => {
    const sealed = previous.encrypt("sk-provider-key");
    const document = JSON.stringify({ name: "OpenAI", keys: { apiKey: sealed }, enabled: true });

    /** @scenario "A sealed value inside a larger stored value is re-sealed in place" */
    it("re-seals the credential under the current key and leaves every other field as it was", () => {
      const moved = resealText({ text: document, current, previous });
      const parsed = JSON.parse(moved.text) as {
        name: string;
        keys: { apiKey: string };
        enabled: boolean;
      };

      expect(moved).toMatchObject({ resealed: 1, alreadyCurrent: 0, undecryptable: 0 });
      expect(current.decrypt(parsed.keys.apiKey)).toBe("sk-provider-key");
      expect(opensUnder(previous, parsed.keys.apiKey)).toBeUndefined();
      expect({ ...parsed, keys: {} }).toEqual({ name: "OpenAI", keys: {}, enabled: true });
    });
  });

  describe("given a prefixed sealed value", () => {
    it("re-seals the sealed part and keeps the prefix", () => {
      const moved = resealText({
        text: `enc:v1:${previous.encrypt("directory-secret")}`,
        current,
        previous,
      });

      expect(moved.text.startsWith("enc:v1:")).toBe(true);
      expect(current.decrypt(moved.text.slice("enc:v1:".length))).toBe("directory-secret");
    });
  });

  describe("given several sealed values in one text", () => {
    it("counts each by the key that opens it", () => {
      const text = JSON.stringify([
        previous.encrypt("one"),
        current.encrypt("two"),
        unknown.encrypt("three"),
        previous.encrypt(""),
      ]);

      const moved = resealText({ text, current, previous });

      expect(moved).toMatchObject({ resealed: 2, alreadyCurrent: 1, undecryptable: 1 });
      const [one, two, three, empty] = JSON.parse(moved.text) as string[];
      expect(current.decrypt(one ?? "")).toBe("one");
      expect(current.decrypt(two ?? "")).toBe("two");
      expect(unknown.decrypt(three ?? "")).toBe("three");
      expect(current.decrypt(empty ?? "")).toBe("");
    });
  });

  describe("given text already re-sealed", () => {
    it("changes nothing on a second pass", () => {
      const once = resealText({ text: previous.encrypt("value"), current, previous });
      const twice = resealText({ text: once.text, current, previous });

      expect(twice).toEqual({ text: once.text, resealed: 0, alreadyCurrent: 1, undecryptable: 0 });
    });
  });

  describe("given text with nothing shaped like a sealed value", () => {
    it.each(["plain text", "https://example.com/a:b:c", '{"id":"0123456789abcdef"}', ""])(
      "leaves %j untouched and counts nothing",
      (text) => {
        expect(resealText({ text, current, previous })).toEqual({
          text,
          resealed: 0,
          alreadyCurrent: 0,
          undecryptable: 0,
        });
      },
    );
  });
});

describe("resealCredentials", () => {
  function seeded() {
    const repository = MemoryCredentialsResealRepository.create();
    const values = {
      old: previous.encrypt("sealed-before-the-rotation"),
      moved: current.encrypt("sealed-after-the-rotation"),
      foreign: unknown.encrypt("sealed-under-an-unknown-key"),
    };
    const rows = new Map(Object.entries(values));
    repository.columns.push({ table: "Secret", column: "encryptedValue", rows });
    const valueOf = (id: string) => rows.get(id) ?? "";
    return { repository, values, valueOf };
  }

  describe("given no previous key", () => {
    /** @scenario "The re-seal task without a previous secret only reports" */
    it("reports what the current key opens and what it does not, and writes nothing", async () => {
      const { repository, values, valueOf } = seeded();

      const report = await resealCredentials({
        repository,
        ciphers: { current, previous: undefined },
      });

      expect(report.previousKeyConfigured).toBe(false);
      expect(report.columns).toEqual([
        {
          table: "Secret",
          column: "encryptedValue",
          resealed: 0,
          alreadyCurrent: 1,
          undecryptable: 2,
          changedMeanwhile: 0,
        },
      ]);
      expect(valueOf("old")).toBe(values.old);
      expect(valueOf("foreign")).toBe(values.foreign);
    });
  });

  describe("given both keys and more rows than one batch holds", () => {
    it("walks every page, moving the previous-key rows and leaving the rest", async () => {
      const { repository, values, valueOf } = seeded();

      const report = await resealCredentials({
        repository,
        ciphers: { current, previous },
        batchSize: 1,
      });

      expect(report.totals).toEqual({ resealed: 1, alreadyCurrent: 1, undecryptable: 1 });
      expect(current.decrypt(valueOf("old"))).toBe("sealed-before-the-rotation");
      expect(valueOf("moved")).toBe(values.moved);
      expect(valueOf("foreign")).toBe(values.foreign);
    });
  });

  describe("given no current key", () => {
    it("refuses before reading anything", async () => {
      const { repository } = seeded();

      await expect(
        resealCredentials({ repository, ciphers: { current: undefined, previous } }),
      ).rejects.toThrow(/CREDENTIALS_SECRET/);
    });
  });

  describe("given an argument the task does not take", () => {
    it("refuses before reading anything", async () => {
      const { repository, values, valueOf } = seeded();
      const task = CredentialsResealTask.create({
        repository: () => repository,
        ciphers: { current, previous },
      });

      await expect(
        task.run({ args: ["--dryrun"], signal: new AbortController().signal }),
      ).rejects.toThrow(/--dry-run/);
      expect(valueOf("old")).toBe(values.old);
    });
  });
});
