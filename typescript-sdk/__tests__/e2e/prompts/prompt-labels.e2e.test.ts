import { describe, it, expect, beforeEach } from "vitest";
import { type LangWatch } from "../../../dist";
import { getLangwatchSDK } from "../../helpers/get-sdk";
import { HandleUtil } from "./helpers/handle.util";

describe("Prompt labels (real API)", () => {
  let langwatch: LangWatch;

  beforeEach(async () => {
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch();
  });

  it("assigns label to version 1 and fetches by label returns version 1 content", async () => {
    const handle = HandleUtil.unique("label-assign");
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

      await langwatch.prompts.labels.assign(handle, {
        label: "production",
        versionId: v1VersionId,
      });

      const fetched = await langwatch.prompts.get(handle, {
        label: "production",
        fetchPolicy: "ALWAYS_FETCH",
      });

      expect(fetched.prompt).toBe("Version 1 content");
    } finally {
      await langwatch.prompts.delete(handle);
    }
  }, 60_000);

  it("reassigns label to version 2 and fetches by label returns version 2 content", async () => {
    const handle = HandleUtil.unique("label-reassign");
    try {
      await langwatch.prompts.create({
        handle,
        prompt: "Version 1 content",
      });
      const v2 = await langwatch.prompts.update(handle, {
        prompt: "Version 2 content",
        commitMessage: "v2",
      });

      const v2VersionId = v2.versionId ?? "";
      expect(v2VersionId).not.toBe("");

      await langwatch.prompts.labels.assign(handle, {
        label: "production",
        versionId: v2VersionId,
      });

      const fetched = await langwatch.prompts.get(handle, {
        label: "production",
        fetchPolicy: "ALWAYS_FETCH",
      });

      expect(fetched.prompt).toBe("Version 2 content");
    } finally {
      await langwatch.prompts.delete(handle);
    }
  }, 60_000);

  it("fetches latest version when no label is specified, regardless of label assignment", async () => {
    const handle = HandleUtil.unique("label-latest");
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

      await langwatch.prompts.labels.assign(handle, {
        label: "production",
        versionId: v1VersionId,
      });

      const fetched = await langwatch.prompts.get(handle, {
        fetchPolicy: "ALWAYS_FETCH",
      });

      expect(fetched.prompt).toBe("Version 2 content");
    } finally {
      await langwatch.prompts.delete(handle);
    }
  }, 60_000);

  it("rejects when fetching with an unassigned label", async () => {
    const handle = HandleUtil.unique("label-unassigned");
    try {
      await langwatch.prompts.create({
        handle,
        prompt: "A prompt with no labels",
      });

      await expect(
        langwatch.prompts.get(handle, {
          label: "production",
          fetchPolicy: "ALWAYS_FETCH",
        }),
      ).rejects.toThrow();
    } finally {
      await langwatch.prompts.delete(handle);
    }
  }, 60_000);
});
