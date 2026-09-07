import { describe, it, expect, beforeEach } from "vitest";
import { type LangWatch } from "../../../dist";
import { getLangwatchSDK } from "../../helpers/get-sdk";
import { HandleUtil } from "./helpers/handle.util";

describe("Prompt tags and versions (real API)", () => {
  let langwatch: LangWatch;

  beforeEach(async () => {
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch();
  });

  describe("when fetching by tag", () => {
    describe("when using explicit tag option", () => {
      it("fetches the tagged version via explicit option", async () => {
        const handle = HandleUtil.unique("tag-explicit");
        const tag = await langwatch.prompts.tags.create({ name: HandleUtil.unique("e2e-tag") });
        try {
          const v1 = await langwatch.prompts.create({
            handle,
            prompt: "Version 1 content",
          });
          await langwatch.prompts.update(handle, {
            prompt: "Version 2 content",
            commitMessage: "v2",
          });

          const v1VersionId = v1.versionId ?? "";
          expect(v1VersionId).not.toBe("");

          await langwatch.prompts.tags.assign(handle, {
            tag: tag.name,
            versionId: v1VersionId,
          });

          const fetched = await langwatch.prompts.get(handle, {
            tag: tag.name,
            fetchPolicy: "ALWAYS_FETCH",
          });

          expect(fetched.prompt).toBe("Version 1 content");
        } finally {
          await langwatch.prompts.delete(handle);
          await langwatch.prompts.tags.delete(tag.name);
        }
      }, 60_000);
    });

    describe("when using shorthand syntax", () => {
      it("fetches the tagged version via shorthand", async () => {
        const handle = HandleUtil.unique("tag-shorthand");
        const tag = await langwatch.prompts.tags.create({ name: HandleUtil.unique("e2e-tag") });
        try {
          const v1 = await langwatch.prompts.create({
            handle,
            prompt: "Version 1 content",
          });
          await langwatch.prompts.update(handle, {
            prompt: "Version 2 content",
            commitMessage: "v2",
          });

          const v1VersionId = v1.versionId ?? "";
          expect(v1VersionId).not.toBe("");

          await langwatch.prompts.tags.assign(handle, {
            tag: tag.name,
            versionId: v1VersionId,
          });

          const fetched = await langwatch.prompts.get(
            `${handle}:${tag.name}`,
            { fetchPolicy: "ALWAYS_FETCH" },
          );

          expect(fetched.prompt).toBe("Version 1 content");
        } finally {
          await langwatch.prompts.delete(handle);
          await langwatch.prompts.tags.delete(tag.name);
        }
      }, 60_000);
    });
  });

  describe("when fetching by version", () => {
    describe("when using explicit version option", () => {
      it("fetches the specific version via explicit option", async () => {
        const handle = HandleUtil.unique("version-explicit");
        try {
          const v1 = await langwatch.prompts.create({
            handle,
            prompt: "Version 1 content",
          });
          await langwatch.prompts.update(handle, {
            prompt: "Version 2 content",
            commitMessage: "v2",
          });

          const fetched = await langwatch.prompts.get(handle, {
            version: String(v1.version),
            fetchPolicy: "ALWAYS_FETCH",
          });

          expect(fetched.prompt).toBe("Version 1 content");
        } finally {
          await langwatch.prompts.delete(handle);
        }
      }, 60_000);
    });

    describe("when using shorthand syntax", () => {
      it("fetches the specific version via shorthand", async () => {
        const handle = HandleUtil.unique("version-shorthand");
        try {
          const v1 = await langwatch.prompts.create({
            handle,
            prompt: "Version 1 content",
          });
          await langwatch.prompts.update(handle, {
            prompt: "Version 2 content",
            commitMessage: "v2",
          });

          const fetched = await langwatch.prompts.get(
            `${handle}:${v1.version}`,
            { fetchPolicy: "ALWAYS_FETCH" },
          );

          expect(fetched.prompt).toBe("Version 1 content");
        } finally {
          await langwatch.prompts.delete(handle);
        }
      }, 60_000);
    });
  });

  describe("when fetching without tag or version", () => {
    it("returns the latest version", async () => {
      const handle = HandleUtil.unique("tag-latest");
      const tag = await langwatch.prompts.tags.create({ name: HandleUtil.unique("e2e-tag") });
      try {
        const v1 = await langwatch.prompts.create({
          handle,
          prompt: "Version 1 content",
        });
        await langwatch.prompts.update(handle, {
          prompt: "Version 2 content",
          commitMessage: "v2",
        });

        const v1VersionId = v1.versionId ?? "";
        expect(v1VersionId).not.toBe("");

        await langwatch.prompts.tags.assign(handle, {
          tag: tag.name,
          versionId: v1VersionId,
        });

        const fetched = await langwatch.prompts.get(handle, {
          fetchPolicy: "ALWAYS_FETCH",
        });

        expect(fetched.prompt).toBe("Version 2 content");
      } finally {
        await langwatch.prompts.delete(handle);
        await langwatch.prompts.tags.delete(tag.name);
      }
    }, 60_000);
  });

  describe("when fetching with unassigned tag", () => {
    it("rejects with an error via shorthand", async () => {
      const handle = HandleUtil.unique("tag-unassigned-shorthand");
      const tag = await langwatch.prompts.tags.create({ name: HandleUtil.unique("e2e-tag") });
      try {
        await langwatch.prompts.create({
          handle,
          prompt: "A prompt with no tags assigned",
        });

        await expect(
          langwatch.prompts.get(`${handle}:${tag.name}`, {
            fetchPolicy: "ALWAYS_FETCH",
          }),
        ).rejects.toThrow();
      } finally {
        await langwatch.prompts.delete(handle);
        await langwatch.prompts.tags.delete(tag.name);
      }
    }, 60_000);

    it("rejects with an error via explicit option", async () => {
      const handle = HandleUtil.unique("tag-unassigned-explicit");
      const tag = await langwatch.prompts.tags.create({ name: HandleUtil.unique("e2e-tag") });
      try {
        await langwatch.prompts.create({
          handle,
          prompt: "A prompt with no tags assigned",
        });

        await expect(
          langwatch.prompts.get(handle, {
            tag: tag.name,
            fetchPolicy: "ALWAYS_FETCH",
          }),
        ).rejects.toThrow();
      } finally {
        await langwatch.prompts.delete(handle);
        await langwatch.prompts.tags.delete(tag.name);
      }
    }, 60_000);
  });
});
