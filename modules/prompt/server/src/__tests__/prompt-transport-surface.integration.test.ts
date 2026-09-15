/**
 * The prompt transports the browser and the API clients already call: the
 * `prompts.*` and `promptTags.*` procedure names, and the `/api/prompts` base
 * path the REST family is published at. Both are declared once in
 * `@langwatch/prompt-server` and mounted over the process's own installed
 * application; this proves the declaration itself, not a process boot.
 * @see modules/prompt/specs/prompt.feature
 */
import { promptTagTrpc, promptTrpc } from "@langwatch/prompt-contract";
import { promptRest, promptTagTrpcTransport, promptTrpcTransport } from "@langwatch/prompt-server";
import { describe, expect, it } from "vitest";

/** The names the browser calls; a rename here breaks every caller of them. */
const PROMPT_PROCEDURES = [
  "getAllPromptsForProject",
  "getCopies",
  "restoreVersion",
  "create",
  "update",
  "updateHandle",
  "getByIdOrHandle",
  "checkHandleUniqueness",
  "checkModifyPermission",
  "getAllVersionsForPrompt",
  "delete",
  "copy",
  "duplicate",
  "syncFromSource",
  "pushToCopies",
  "getTagsForConfig",
  "assignTag",
];

const PROMPT_TAG_PROCEDURES = ["getAll", "create", "rename", "delete"];

describe("given the prompt transports declared by the module", () => {
  describe("when a caller uses tRPC", () => {
    /** @scenario existing transports preserve their public surface */
    it("answers to the procedure names its callers already use", () => {
      expect(promptTrpcTransport.namespace).toBe("prompts");
      expect(promptTagTrpcTransport.namespace).toBe("promptTags");
      expect(Object.keys(promptTrpc.members).sort()).toEqual([...PROMPT_PROCEDURES].sort());
      expect(Object.keys(promptTagTrpc.members).sort()).toEqual([...PROMPT_TAG_PROCEDURES].sort());
    });
  });

  describe("when a caller uses the REST prompt API", () => {
    /** @scenario existing transports preserve their public surface */
    it("publishes the same /api/prompts paths, declared without constructing an application", () => {
      const paths = [...new Set(promptRest.router().routes.map((route) => route.path))];

      // The family is twinned onto /api/v1 by the runtime; the /api addresses
      // its callers already hold are what must not move.
      expect(paths).toEqual(
        expect.arrayContaining([
          "/api/prompts",
          "/api/prompts/:id{.+}",
          "/api/prompts/:id{.+?}/versions",
          "/api/prompts/:id{.+?}/versions/:versionId/restore",
          "/api/prompts/:id{.+?}/tags/:tag",
          "/api/prompts/tags",
          "/api/prompts/tags/:tag",
          "/api/prompts/:id{.+?}/sync",
        ]),
      );
    });
  });
});
