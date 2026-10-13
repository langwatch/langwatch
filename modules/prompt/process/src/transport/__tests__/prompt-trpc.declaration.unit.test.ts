/**
 * The two prompt tRPC namespaces, as the wire has them: every procedure the
 * browser calls, its kind, and the permission the server binds to it.
 */
import { promptTagTrpc, promptTrpc } from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import { promptTagTrpcTransport } from "../prompt-tag.trpc.ts";
import { promptTrpcTransport } from "../prompt.trpc.ts";
import { accessDeclaredBy } from "./prompt-trpc.fixture.ts";

describe("the prompts tRPC namespace", () => {
  it("binds every declared procedure once and preserves its permission", () => {
    const declarations = accessDeclaredBy(promptTrpcTransport);

    expect(
      Object.entries(promptTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        declarations[index],
      ]),
    ).toEqual([
      ["getAllPromptsForProject", "query", "prompts:view"],
      ["getCopies", "query", "prompts:view"],
      ["restoreVersion", "mutation", "prompts:update"],
      ["create", "mutation", "prompts:create"],
      ["update", "mutation", "prompts:update"],
      ["updateHandle", "mutation", "prompts:update"],
      ["getByIdOrHandle", "query", "prompts:view"],
      ["checkHandleUniqueness", "query", "prompts:view"],
      ["checkModifyPermission", "query", "prompts:view"],
      ["getAllVersionsForPrompt", "query", "prompts:view"],
      ["delete", "mutation", "prompts:delete"],
      ["copy", "mutation", "prompts:create"],
      ["duplicate", "mutation", "prompts:create"],
      ["syncFromSource", "mutation", "prompts:update"],
      ["pushToCopies", "mutation", "prompts:update"],
      ["getTagsForConfig", "query", "prompts:view"],
      ["assignTag", "mutation", "prompts:update"],
    ]);
  });
});

describe("the promptTags tRPC namespace", () => {
  it("binds every declared procedure once and preserves its permission", () => {
    const declarations = accessDeclaredBy(promptTagTrpcTransport);

    expect(
      Object.entries(promptTagTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        declarations[index],
      ]),
    ).toEqual([
      ["getAll", "query", "prompts:view"],
      ["create", "mutation", "prompts:manage"],
      ["rename", "mutation", "prompts:manage"],
      ["delete", "mutation", "prompts:manage"],
    ]);
  });
});
