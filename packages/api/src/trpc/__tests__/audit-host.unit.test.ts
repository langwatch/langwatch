/**
 * The tRPC host's write path onto the deployment's audit trail: one row per answered mutation,
 * filed under the scopes its arguments named. Spec: specs/audit-log/audit-log.feature.
 */

import type { PermissionDecision } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import type { TrpcAuditSink } from "../../hosting/api-door.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

interface RenameApi {
  rename(input: { organizationId: string; projectId: string; name: string }): Promise<{
    renamed: boolean;
  }>;
}

const RenameApi = moduleApi<RenameApi>()("project");

const contract = defineTrpcContract("project")
  .mutation("rename")
  .withInput(z.object({ organizationId: z.string(), projectId: z.string(), name: z.string() }))
  .withOutput(z.object({ renamed: z.boolean() }))
  .build();

function declaration() {
  return defineTrpcRouter(RenameApi, contract)
    .procedure("rename")
    .withPermission("project:update", { via: "projectId" })
    .handle(({ app, input }) => app.rename(input))
    .build();
}

type Recorded = Parameters<TrpcAuditSink["record"]>[0];
type LogRecord = { level: string; fields: unknown; message?: string | undefined };

function served({
  audit,
  impersonator,
}: {
  audit: TrpcAuditSink | undefined;
  impersonator?: string;
}) {
  const logs: LogRecord[] = [];
  const at =
    (level: string) =>
    (fields: unknown, message?: string): void => {
      logs.push({ level, fields, message });
    };
  const authz = createApiDouble<Authorize>({
    getDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: "ADMIN",
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => null,
    projectKindOf: async () => "application",
  });
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({
      verify: async () => ({
        userId: "sam",
        ...(impersonator ? { impersonator: { id: impersonator } } : {}),
      }),
    }),
    authz,
    audit,
    logger: { warn: at("warn"), error: at("error") },
  });
  const rename = vi.fn(async (_input: { projectId: string }) => ({ renamed: true }));
  trpc.mount(composeTrpcRouters("project", [declaration()]), () => ({ rename }));

  /** Posts one `project.rename` call through the host, as a browser would. */
  const renameIn = async (
    input: { organizationId: string; projectId: string; name: string },
    from: { address?: string; userAgent?: string } = {},
  ) => {
    const request = new Request(`http://api.test${TrpcHost.path}/project.rename`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(from.userAgent ? { "User-Agent": from.userAgent } : {}),
      },
      body: JSON.stringify(input),
    });
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => trpc.context({ request, address: from.address }),
    });

    return (await response.json()) as { result?: { data?: unknown }; error?: unknown };
  };

  return { logs, rename, renameIn };
}

describe("given a process whose door records through an installed audit trail", () => {
  describe("when a mutation naming an organization and a project is answered", () => {
    /** @scenario "A recorded mutation lands on the audit trail with the scopes it named" */
    it("records one row with the actor, the action, the arguments and both scopes", async () => {
      const rows: Recorded[] = [];
      const { renameIn, rename } = served({ audit: { record: (entry) => void rows.push(entry) } });

      const answer = await renameIn({
        organizationId: "organization-1",
        projectId: "project-1",
        name: "demo",
      });

      expect(answer.result?.data).toEqual({ renamed: true });
      expect(rename).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: "sam",
        action: "project.rename",
        organizationId: "organization-1",
        projectId: "project-1",
        args: { organizationId: "organization-1", projectId: "project-1", name: "demo" },
      });
      expect(rows[0]?.error).toBeUndefined();
    });
  });
});

describe("given a process whose door records through an installed audit trail, as main did", () => {
  describe("when a signed-in caller's mutation is answered", () => {
    /** @scenario "A recorded mutation keeps where it came from and who really made it" */
    it("records the address the door resolved and the caller's user agent", async () => {
      const rows: Recorded[] = [];
      const { renameIn } = served({ audit: { record: (entry) => void rows.push(entry) } });

      await renameIn(
        { organizationId: "organization-1", projectId: "project-1", name: "demo" },
        { address: "203.0.113.7", userAgent: "Mozilla/5.0 (audit test)" },
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0 (audit test)",
      });
      expect(rows[0]?.actorUserId).toBeUndefined();
    });

    /** @scenario "A recorded mutation keeps where it came from and who really made it" */
    it("names the operator behind an impersonated call as the row's actor", async () => {
      const rows: Recorded[] = [];
      const { renameIn } = served({
        audit: { record: (entry) => void rows.push(entry) },
        impersonator: "operator-1",
      });

      await renameIn({ organizationId: "organization-1", projectId: "project-1", name: "demo" });

      expect(rows[0]).toMatchObject({
        userId: "sam",
        actorUserId: "operator-1",
        metadata: { impersonatorId: "operator-1" },
      });
    });
  });
});

const selfAudited = defineTrpcContract("joinRequests")
  .mutation("setJoining")
  .withInput(z.object({ organizationId: z.string(), projectId: z.string() }))
  .withOutput(z.object({ changed: z.boolean() }))

  .mutation("dismissOffer")
  .withInput(z.object({ organizationId: z.string(), projectId: z.string() }))
  .withOutput(z.object({ changed: z.boolean() }))

  .mutation("renameDomain")
  .withInput(z.object({ organizationId: z.string(), projectId: z.string() }))
  .withOutput(z.object({ changed: z.boolean() }))

  .query("joining")
  .withInput(z.object({ organizationId: z.string(), projectId: z.string() }))
  .withOutput(z.object({ changed: z.boolean() }))
  .build();

const JoinApi = moduleApi<Record<string, never>>()("identity");

class JoiningRefusedError extends HandledError {
  constructor() {
    super("joining_refused", "The joining setting was refused", { httpStatus: 409 });
    this.name = "JoiningRefusedError";
  }
}

function selfAuditedRouter() {
  return defineTrpcRouter(JoinApi, selfAudited).procedure("setJoining");
}

/**
 * Posts one mutation of the self-audited router through a host whose sink keeps the rows. The
 * handler refuses with a handled error under `refuse: "handler"`; the door under `"door"`.
 */
async function callSelfAudited(
  procedure: "setJoining" | "dismissOffer" | "renameDomain",
  { refuse }: { refuse?: "handler" | "door" } = {},
) {
  const rows: Recorded[] = [];
  const answer = async () => {
    if (refuse === "handler") throw new JoiningRefusedError();
    return { changed: true };
  };
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz: createApiDouble<Authorize>({
      getDecision: async (): Promise<PermissionDecision> => ({
        permitted: refuse !== "door",
        organizationRole: "ADMIN",
      }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
      organizationOf: async () => null,
      projectKindOf: async () => "application",
    }),
    audit: { record: (entry) => void rows.push(entry) },
  });
  const declared = selfAuditedRouter()
    .withoutAudit("the join request service records the row with the value it replaced")
    .withPermission("project:update", { via: "projectId" })
    .handle(answer)
    .procedure("dismissOffer")
    .withPermission("project:update", { via: "projectId" })
    .handle(answer)
    .procedure("renameDomain")
    .withoutAudit("the service records only what it changed", { refusals: "generic" })
    .withPermission("project:update", { via: "projectId" })
    .handle(answer)
    .procedure("joining")
    .withPermission("project:view", { via: "projectId" })
    .handle(answer)
    .build();
  trpc.mount(composeTrpcRouters("joinRequests", [declared]), () => ({}));
  const request = new Request(`http://api.test${TrpcHost.path}/joinRequests.${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: "organization-1", projectId: "project-1" }),
  });
  await fetchRequestHandler({
    endpoint: TrpcHost.path,
    req: request,
    router: trpc.router,
    createContext: () => trpc.context({ request }),
  });

  return rows;
}

describe("given a mutation declared withoutAudit because its service writes its own rows", () => {
  describe("when it is answered", () => {
    /** @scenario "A mutation that audits itself is recorded once" */
    it("leaves the generic row out", async () => {
      expect(await callSelfAudited("setJoining")).toEqual([]);
    });

    /** @scenario "A mutation that audits itself is recorded once" */
    it("still records every other mutation of the same router", async () => {
      expect(await callSelfAudited("dismissOffer")).toEqual([
        expect.objectContaining({ userId: "sam", action: "joinRequests.dismissOffer" }),
      ]);
    });
  });

  describe("when its service refuses the call", () => {
    /** @scenario "A mutation that audits itself is recorded once, refused or answered" */
    it("leaves the generic row out, since the service recorded the refusal", async () => {
      expect(await callSelfAudited("setJoining", { refuse: "handler" })).toEqual([]);
    });

    /** @scenario "A mutation that audits itself is recorded once, refused or answered" */
    it("still writes the generic row for a service that records only what it changed", async () => {
      expect(await callSelfAudited("renameDomain", { refuse: "handler" })).toEqual([
        expect.objectContaining({
          userId: "sam",
          action: "joinRequests.renameDomain",
          error: expect.any(Error),
        }),
      ]);
    });
  });

  describe("when the door refuses the call before its service runs", () => {
    /** @scenario "A mutation that audits itself is recorded once, refused or answered" */
    it("writes the one generic row, since the service never saw the call", async () => {
      expect(await callSelfAudited("setJoining", { refuse: "door" })).toEqual([
        expect.objectContaining({
          userId: "sam",
          action: "joinRequests.setJoining",
          error: expect.any(Error),
        }),
      ]);
    });
  });

  describe("when a mutation that writes the generic row is refused by its handler", () => {
    /** @scenario "A mutation that audits itself is recorded once, refused or answered" */
    it("records the refusal once, not a second failed-call row beside it", async () => {
      expect(await callSelfAudited("dismissOffer", { refuse: "handler" })).toEqual([
        expect.objectContaining({
          action: "joinRequests.dismissOffer",
          error: expect.any(Error),
        }),
      ]);
    });
  });

  describe("when the declaration is malformed", () => {
    /** @scenario "A mutation that audits itself is recorded once" */
    it("refuses an empty reason, a query, a second declaration and one beside withAudit", () => {
      expect(() => selfAuditedRouter().withoutAudit(" ")).toThrow(/needs a reason/);
      expect(() =>
        defineTrpcRouter(JoinApi, selfAudited).procedure("joining").withoutAudit("a read"),
      ).toThrow(/not a mutation/);
      expect(() => selfAuditedRouter().withoutAudit("own row").withoutAudit("again")).toThrow(
        /already declares withoutAudit/,
      );
      expect(() =>
        defineTrpcRouter(RenameApi, contract)
          .procedure("rename")
          .withAudit({ target: "organization", via: "projectId" })
          .withoutAudit("own row"),
      ).toThrow(/already declares withAudit/);
      expect(() =>
        defineTrpcRouter(RenameApi, contract)
          .procedure("rename")
          .withoutAudit("own row")
          .withAudit({ target: "organization", via: "projectId" }),
      ).toThrow(/already declares withoutAudit/);
    });
  });
});

describe("given a process that installed no audit trail", () => {
  describe("when a mutation is answered", () => {
    /** @scenario "A process that installed no audit trail says so instead of failing the call it was recording" */
    it("answers the call and warns, naming the audit-log module it is missing", async () => {
      const { renameIn, logs } = served({ audit: undefined });

      const answer = await renameIn({
        organizationId: "organization-1",
        projectId: "project-1",
        name: "demo",
      });

      expect(answer.result?.data).toEqual({ renamed: true });
      expect(logs).toEqual([
        expect.objectContaining({
          level: "warn",
          fields: { trail: "audit-log", action: "project.rename" },
        }),
      ]);
    });
  });
});
