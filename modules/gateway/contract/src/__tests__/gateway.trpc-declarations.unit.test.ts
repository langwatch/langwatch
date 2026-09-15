/**
 * @vitest-environment node
 *
 * The wire the browser already calls, pinned as a declaration: the namespace
 * each contract mounts under, the procedures inside it, and whether each one
 * reads or writes. A rename here is a client-breaking change, and this is
 * where it has to be made deliberately.
 */
import { describe, expect, it } from "vitest";

import { gatewayBudgetTrpc } from "../gateway-budget.trpc.ts";
import { gatewayCacheRuleTrpc } from "../gateway-cache-rule.trpc.ts";
import { gatewayGuardrailTrpc } from "../gateway-guardrail.trpc.ts";
import { gatewayUsageTrpc } from "../gateway-usage.trpc.ts";
import { virtualKeyTrpc } from "../virtual-key.trpc.ts";

function kinds(contract: { members: Readonly<Record<string, { kind: string }>> }) {
  return Object.fromEntries(
    Object.entries(contract.members).map(([name, member]) => [name, member.kind]),
  );
}

describe("the gateway's declared tRPC namespaces", () => {
  describe("when a client calls the budgets namespace", () => {
    it("answers under gatewayBudgets with eight procedures", () => {
      expect(gatewayBudgetTrpc.namespace).toBe("gatewayBudgets");
      expect(kinds(gatewayBudgetTrpc)).toEqual({
        list: "query",
        listForProject: "query",
        get: "query",
        groupTargets: "query",
        create: "mutation",
        update: "mutation",
        archive: "mutation",
        reset: "mutation",
      });
    });
  });

  describe("when a client calls the virtual-key namespace", () => {
    it("answers under virtualKeys with ten procedures", () => {
      expect(virtualKeyTrpc.namespace).toBe("virtualKeys");
      expect(kinds(virtualKeyTrpc)).toEqual({
        list: "query",
        get: "query",
        spendThisMonth: "query",
        applicableBudgets: "query",
        create: "mutation",
        update: "mutation",
        rotate: "mutation",
        revoke: "mutation",
        disable: "mutation",
        enable: "mutation",
      });
    });
  });

  describe("when a client calls the usage namespace", () => {
    it("answers under gatewayUsage with two procedures", () => {
      expect(gatewayUsageTrpc.namespace).toBe("gatewayUsage");
      expect(kinds(gatewayUsageTrpc)).toEqual({
        summary: "query",
        summaryForVirtualKey: "query",
      });
    });
  });

  describe("when a client calls the cache-rule namespace", () => {
    it("answers under gatewayCacheRules with five procedures", () => {
      expect(gatewayCacheRuleTrpc.namespace).toBe("gatewayCacheRules");
      expect(kinds(gatewayCacheRuleTrpc)).toEqual({
        list: "query",
        get: "query",
        create: "mutation",
        update: "mutation",
        archive: "mutation",
      });
    });
  });

  describe("when a client calls the guardrail namespace", () => {
    it("answers under gatewayGuardrails with five procedures", () => {
      expect(gatewayGuardrailTrpc.namespace).toBe("gatewayGuardrails");
      expect(kinds(gatewayGuardrailTrpc)).toEqual({
        list: "query",
        get: "query",
        create: "mutation",
        update: "mutation",
        archive: "mutation",
      });
    });
  });
});
