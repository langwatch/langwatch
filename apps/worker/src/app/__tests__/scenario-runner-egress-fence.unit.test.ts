/**
 * The fence a scenario run dials an HTTP target through, composed the way the
 * runner composes it: the worker resolves the deployment's egress leaves,
 * states them on the child's environment, and the child turns that document
 * back into the validator it calls per request. TLS is the parent's other
 * stated decision, carried as the child's NODE_TLS_REJECT_UNAUTHORIZED.
 *
 * @see specs/features/scenarios/on-prem-hostname-validation.feature
 */
import dns from "node:dns/promises";
import { createSsrfUrlValidator } from "@langwatch/egress";
import {
  decodeScenarioEgressPolicy,
  encodeScenarioEgressPolicy,
  resolveChildTlsEnv,
} from "@langwatch/scenario-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkerConfig } from "../../platform/config/worker.config";

/** The parent's two lines, then the child's one, for a given environment. */
function runnerUrlValidator(source: Record<string, string>) {
  const { modelProvider } = resolveWorkerConfig(source).infrastructure;
  const encoded = encodeScenarioEgressPolicy({
    blockLocal: modelProvider.blockLocalHttpCalls,
    allowedHosts: [...modelProvider.allowedProxyHosts],
  });
  return createSsrfUrlValidator(decodeScenarioEgressPolicy(encoded));
}

/** The child's own `rejectUnauthorized`, read off the environment the parent stated. */
function runnerRejectsUnauthorized(isSaaS: boolean): boolean {
  const childEnv = resolveChildTlsEnv({
    isSaaS,
    nodeEnv: "development",
    nodeExtraCaCerts: undefined,
  });
  return childEnv.NODE_TLS_REJECT_UNAUTHORIZED !== "0";
}

function resolvesTo(records: { a?: string[]; aaaa?: string[] }) {
  vi.spyOn(dns, "resolve").mockImplementation((async (_hostname: string, recordType: string) =>
    recordType === "A" ? (records.a ?? []) : (records.aaaa ?? [])) as never);
}

afterEach(() => vi.restoreAllMocks());

describe("the scenario runner's outbound fence", () => {
  describe("given BLOCK_LOCAL_HTTP_CALLS is unset", () => {
    describe("when the runner validates a private destination", () => {
      /** @scenario "Scenario runner reaches a private hostname when BLOCK_LOCAL_HTTP_CALLS is unset" */
      it("admits a hostname that resolves into a private range", async () => {
        resolvesTo({ a: ["10.0.0.5"] });

        await expect(
          runnerUrlValidator({})("https://agent.internal.example.test/chat"),
        ).resolves.toMatchObject({ type: "resolved", resolvedIp: "10.0.0.5" });
      });

      /** @scenario "Private IP literals are allowed when BLOCK_LOCAL_HTTP_CALLS is unset" */
      it("admits a private IP literal", async () => {
        await expect(runnerUrlValidator({})("http://10.0.0.5:8080/chat")).resolves.toMatchObject({
          type: "resolved",
          resolvedIp: "10.0.0.5",
          port: 8080,
        });
      });
    });
  });

  describe('given BLOCK_LOCAL_HTTP_CALLS is "true"', () => {
    const blocking = { BLOCK_LOCAL_HTTP_CALLS: "true" };

    describe("when the runner validates a private destination", () => {
      /** @scenario 'Scenario runner blocks a private hostname when BLOCK_LOCAL_HTTP_CALLS is "true"' */
      it("refuses a hostname that resolves into a private range", async () => {
        resolvesTo({ a: ["10.0.0.5"] });

        await expect(
          runnerUrlValidator(blocking)("https://agent.internal.example.test/chat"),
        ).rejects.toThrow(/private or localhost IP/i);
      });

      /** @scenario 'Private IP literals are blocked when BLOCK_LOCAL_HTTP_CALLS is "true"' */
      it("refuses a private IP literal", async () => {
        await expect(runnerUrlValidator(blocking)("http://10.0.0.5:8080/chat")).rejects.toThrow(
          /private or localhost IP/i,
        );
      });
    });
  });

  describe("given either setting of BLOCK_LOCAL_HTTP_CALLS", () => {
    const toggles: Record<string, string>[] = [
      {},
      { BLOCK_LOCAL_HTTP_CALLS: "true" },
      { BLOCK_LOCAL_HTTP_CALLS: "false" },
    ];

    describe("when the runner validates a cloud metadata endpoint", () => {
      /** @scenario "Cloud metadata endpoints are blocked even when BLOCK_LOCAL_HTTP_CALLS is <toggle>" */
      it("refuses it whatever the local-address policy says", async () => {
        for (const source of toggles) {
          await expect(
            runnerUrlValidator(source)("http://169.254.169.254/latest/meta-data/"),
          ).rejects.toThrow(/cloud metadata endpoints is not allowed/i);
        }
      });
    });

    describe("when the runner validates a cloud provider internal domain", () => {
      /** @scenario "Cloud provider internal domains are blocked even when BLOCK_LOCAL_HTTP_CALLS is <toggle>" */
      it("refuses it whatever the local-address policy says", async () => {
        for (const source of toggles) {
          await expect(
            runnerUrlValidator(source)("https://metadata.google.internal/chat"),
          ).rejects.toThrow(/cloud provider internal domains is not allowed/i);
        }
      });
    });
  });

  describe("given the deployment is not SaaS", () => {
    describe("when the runner builds a fetch request", () => {
      /** @scenario "Scenario runner allows self-signed certificates when IS_SAAS is false" */
      it("dials with certificate verification off", () => {
        expect(runnerRejectsUnauthorized(false)).toBe(false);
      });
    });
  });

  describe("given the deployment is SaaS", () => {
    describe("when the runner builds a fetch request", () => {
      /** @scenario "Scenario runner enforces TLS certificates when IS_SAAS is true" */
      it("dials with certificate verification on", () => {
        expect(runnerRejectsUnauthorized(true)).toBe(true);
      });
    });
  });
});
