/**
 * The langy ops functions through the staff access module, over the memory twins with Langy as a
 * stand-in; Langy's own read is proven against Postgres in modules/langy.
 * @see modules/staff-access/specs/staff-access-functions-langy.feature
 */
import { ClientAddress } from "@langwatch/api/policy";
import type { StaffAccessDoorSession } from "@langwatch/staff-access-contract";
import { describe, expect, it } from "vitest";

import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import {
  ACME,
  AGENT_IP,
  GLOBEX,
  requestBody,
  staffAccessWorld,
  VERIFIER,
} from "./support/staff-access-world.ts";

const PROJECT = `${ACME.id}_project`;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function requestFrom({ bearer }: { bearer: string }): Request {
  const request = new Request("https://app.langwatch.test/api/staff-access/functions", {
    headers: { authorization: `Bearer ${bearer}`, "user-agent": "langwatch-cli" },
  });
  ClientAddress.fromTrustedProxies({}).handle({ request, socketAddress: AGENT_IP });
  return request;
}

/** A redeemed `org:metadata` session on ACME naming `functions`, and a caller for them. */
async function sessionFor({ functions }: { functions: string[] }) {
  const w = staffAccessWorld({ repositories: MemoryStaffAccessRepositories.create() });
  const agent = await w.enrol();
  const { requestId } = await w.app.createRequest({
    session: agent.session,
    body: requestBody({ scopes: ["org:metadata"], functions }),
  });
  await w.approve({ choice: { requestId, spendApproved: false } });
  const answer = await w.app.redeem({ session: agent.session, requestId, codeVerifier: VERIFIER });
  const caller = await Promise.resolve(
    w.app.staffAccessDoor.identify?.({ request: requestFrom({ bearer: answer.opsToken ?? "" }) }),
  );
  const session = caller?.session as StaffAccessDoorSession;
  return {
    platform: w.state.platform,
    call: (name: string, input: unknown) => w.app.callFunction({ session, name, input }),
  };
}

describe("given ACME's people use Langy", () => {
  describe("when the agent calls org.langy", () => {
    /** @scenario "org.langy answers turns per day, model, state and failure code" */
    /** @scenario "org.langy reads only the approved organization" */
    it("answers ACME's turn groups as a page with codes and counts and no text", async () => {
      const { call, platform } = await sessionFor({ functions: ["org.langy"] });

      const answered = await call("org.langy", { since: "2026-10-27T10:00:00Z" });

      expect(answered.output).toEqual({
        items: [
          {
            day: "2026-11-01",
            model: "openai/gpt-5.4-mini",
            turnState: "completed",
            failureCode: null,
            toolErrorsByTool: {},
            turns: 9,
            users: 4,
          },
          {
            day: "2026-11-01",
            model: "openai/gpt-5.4-mini",
            turnState: "failed",
            failureCode: "langy_agent_errored",
            toolErrorsByTool: { "langwatch.trace": 2 },
            turns: 3,
            users: 2,
          },
        ],
        total: 2,
        truncated: false,
        nextCursor: null,
      });
      expect(JSON.stringify(answered.output)).not.toContain(GLOBEX.id);
      expect(platform.langyProjectAsks).toEqual([[PROJECT]]);
    });

    /** @scenario "org.langy refuses a range over 31 days" */
    it("refuses a range over 31 days", async () => {
      const { call } = await sessionFor({ functions: ["org.langy"] });

      await expect(codeOf(call("org.langy", { since: "2026-09-20T00:00:00Z" }))).resolves.toBe(
        "staff_function_bad_input",
      );
    });
  });

  describe("when the agent calls org.langy_turn", () => {
    /** @scenario "org.langy_turn answers one conversation's turns and tool calls without text" */
    it("answers each turn's state and code and each tool call's target, as pages", async () => {
      const { call } = await sessionFor({ functions: ["org.langy_turn"] });

      const answered = await call("org.langy_turn", {
        projectId: PROJECT,
        conversationId: "conv_acme",
      });

      expect(answered.output).toMatchObject({
        total: 2,
        truncated: false,
        items: [
          {
            turnId: "turn_1",
            createdAt: "2026-11-01T09:00:00.000Z",
            state: "completed",
            failureCode: null,
            toolCalls: {
              items: [
                {
                  tool: "langwatch.dashboards",
                  status: "succeeded",
                  targetKind: "dashboard",
                  targetId: "dash_open",
                },
              ],
              total: 1,
              truncated: false,
              nextCursor: null,
            },
          },
          {
            turnId: "turn_2",
            state: "failed",
            failureCode: "langy_turn_timeout",
            endedAt: null,
            toolCalls: { items: [{ tool: "bash", status: "failed", waitKind: "permission" }] },
          },
        ],
      });
    });

    /** @scenario "org.langy_turn refuses a project outside the organization or an unknown conversation" */
    it("refuses another organization's project and a conversation the project does not hold", async () => {
      const { call } = await sessionFor({ functions: ["org.langy_turn"] });

      await expect(
        codeOf(
          call("org.langy_turn", {
            projectId: `${GLOBEX.id}_project`,
            conversationId: "conv_acme",
          }),
        ),
      ).resolves.toBe("staff_function_not_found");
      await expect(
        codeOf(call("org.langy_turn", { projectId: PROJECT, conversationId: "conv_nope" })),
      ).resolves.toBe("staff_function_not_found");
    });
  });
});
