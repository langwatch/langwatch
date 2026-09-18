/**
 * The prompt transports the browser and API clients call: `prompts.*` /
 * `promptTags.*` procedure names, and the `/api/prompts` REST base path -
 * declared once by this module and mounted here to prove it.
 * @see modules/prompt/specs/prompt.feature
 */
import { promptTagTrpc, promptTrpc } from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import { promptTagTrpcTransport } from "../transport/prompt-tag.trpc.ts";
import { promptRest } from "../transport/prompt.rest.ts";
import { promptTrpcTransport } from "../transport/prompt.trpc.ts";

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
      expect(Object.keys(promptTrpc.members).toSorted()).toEqual([...PROMPT_PROCEDURES].toSorted());
      expect(Object.keys(promptTagTrpc.members).toSorted()).toEqual(
        [...PROMPT_TAG_PROCEDURES].toSorted(),
      );
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
