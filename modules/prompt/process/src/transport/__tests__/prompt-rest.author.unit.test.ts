import type { AuthzApi } from "@langwatch/authz-contract";
/**
 * A body-supplied `authorId` on `/api/prompts` must hold the write's
 * permission on the project; an absent one is not checked.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { PromptService } from "../../services/prompt.service.ts";
import { buildPromptApp, mountPromptRest, PROMPT_TEST_PROJECT } from "./prompt-rest.harness.ts";

const AUTHOR_BODY = { handle: "agent", prompt: "Be brief.", commitMessage: "v1" };

function send(input: { method: "POST" | "PUT"; authorId?: string; holds: (p: string) => boolean }) {
  const hasPermission = vi.fn(async (check: { permission: string }) =>
    input.holds(check.permission),
  );
  const written = vi.fn(async () => {
    throw new Error("write reached the engine");
  });
  const app = buildPromptApp(
    createApiFixture<PromptService>({ createPrompt: written, updatePrompt: written }),
    createApiFixture<AuthzApi>({ hasPermission: hasPermission as AuthzApi["hasPermission"] }),
  );
  const path = input.method === "POST" ? "/api/prompts" : "/api/prompts/agent";
  const response = mountPromptRest({ app }).request(path, {
    method: input.method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...AUTHOR_BODY, authorId: input.authorId }),
  });
  return { response, hasPermission, written };
}

describe("the /api/prompts body authorId", () => {
  describe.each([
    ["POST", "prompts:create"],
    ["PUT", "prompts:update"],
  ] as const)("when a caller sends %s", (method, permission) => {
    /** @scenario "a REST author who is not a user is refused" */
    /** @scenario "a REST author without the write permission is refused" */
    it("refuses an author who does not hold the permission, as 422 prompt_author_unknown", async () => {
      const sent = send({ method, authorId: "user_unknown", holds: () => false });
      const response = await sent.response;
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(422);
      expect(body.code).toBe("prompt_author_unknown");
      expect(sent.hasPermission).toHaveBeenCalledWith({
        userId: "user_unknown",
        permission,
        projectId: PROMPT_TEST_PROJECT,
      });
      expect(sent.written).not.toHaveBeenCalled();
    });

    /** @scenario "a REST author holding the write permission is accepted" */
    it("lets a permitted author through to the write", async () => {
      const sent = send({ method, authorId: "user_1", holds: (p) => p === permission });
      const response = await sent.response;
      const body = (await response.json()) as { code?: string };

      expect(body.code).not.toBe("prompt_author_unknown");
      expect(sent.written).toHaveBeenCalledOnce();
    });

    /** @scenario "a REST write with no authorId is unchanged" */
    it("checks nothing when no authorId is given", async () => {
      const sent = send({ method, holds: () => false });
      await sent.response;

      expect(sent.hasPermission).not.toHaveBeenCalled();
      expect(sent.written).toHaveBeenCalledOnce();
    });
  });
});
