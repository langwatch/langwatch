/**
 * @vitest-environment node
 * Which caller the bug-report intake counts: the address the door resolved, never a header.
 * @see specs/security/trusted-client-address.feature
 */
import { ProjectInvalidCredentialsError } from "@langwatch/api";
import {
  bindMiddlewareContext,
  callerAddressContext,
  canonicalErrorResponse,
  createRestRuntime,
} from "@langwatch/api/rest";
import { InMemoryProcessStore } from "@langwatch/eventing";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createOpsTestApp } from "../../app/__tests__/ops.fixture.ts";
import { MemoryOpsRepositories } from "../../repositories/memory/memory.ops.repositories.ts";
import { opsBugReportRest } from "../ops-bug-report.rest.ts";

const RESOLVED_CALLER = "198.51.100.11";

/** The intake over memory rows, remembering every rate-limit key the application consumed. */
function intake({ callerAddress }: { callerAddress: string | null }) {
  const keys: string[] = [];
  const repositories = MemoryOpsRepositories.create({
    eventing: { definitions: [] },
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const { app } = createOpsTestApp({
    repositories: {
      ...repositories,
      bugReportRateLimit: {
        consume: (window) => {
          keys.push(window.key);
          return repositories.bugReportRateLimit.consume(window);
        },
      },
    },
    members: { bugReportNotifier: { notify: async () => void 0 } },
  });
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("The intake asks no permission of its credential.");
      },
      // No key is presented, so the optional door files the report unlinked.
      identify: () => {
        throw new ProjectInvalidCredentialsError();
      },
    },
  }).mount(opsBugReportRest.router(), {
    app: () => app,
    onError: (error, context) => canonicalErrorResponse(error, context),
    middlewareContext: [bindMiddlewareContext(callerAddressContext, () => callerAddress)],
  });

  const post = () =>
    runtime.request("/api/bug-reports", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.66" },
      body: JSON.stringify({ source: "cli", kind: "summary", title: "t", summary: "s" }),
    });

  return { keys, post };
}

describe("given the bug-report intake behind the resolved caller address", () => {
  describe("when a report arrives carrying a forged X-Forwarded-For", () => {
    /** @scenario "The bug-report intake counts the resolved address" */
    it("keys the caller on the resolved address, not the forged header", async () => {
      const { keys, post } = intake({ callerAddress: RESOLVED_CALLER });

      const response = await post();

      expect(response.status).toBe(201);
      expect(keys).toEqual([`bug-report:ip:${RESOLVED_CALLER}`]);
    });
  });

  describe("when the door resolved no address for the caller", () => {
    it("still counts it, under the one unknown caller", async () => {
      const { keys, post } = intake({ callerAddress: null });

      await post();

      expect(keys).toEqual(["bug-report:ip:unknown"]);
    });
  });
});
