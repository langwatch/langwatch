/**
 * The tRPC record the api mounts, asked over HTTP on the api booted wholly live over Postgres,
 * Redis and ClickHouse (§7).
 * @vitest-environment node
 * @see specs/server/api-process-trpc-record.feature
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import { PresenceApi } from "@langwatch/presence-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";
import {
  bootLiveApi,
  callTrpc,
  liveStoresConfigured,
  openLivePrisma,
  removeSeededTraces,
  removeSignedUpRows,
  seedProject,
  seedTraceSummary,
  signUpSession,
  type LiveApi,
} from "./api-live.fixture.ts";

type DeclaredProcedure = { path: string; kind: "query" | "mutation" };

/** Every query and mutation the installed modules declare, as `namespace.name`. */
function declaredProcedures(): DeclaredProcedure[] {
  const declared: DeclaredProcedure[] = [];
  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (transport.protocol !== "trpc" || !("contract" in transport)) continue;
      const { contract } = transport;
      if (typeof contract !== "object" || contract === null || !("members" in contract)) continue;
      const members = contract.members as Record<string, { kind: string }>;
      for (const [name, member] of Object.entries(members)) {
        if (member.kind === "query" || member.kind === "mutation") {
          declared.push({ path: `${transport.namespace}.${name}`, kind: member.kind });
        }
      }
    }
  }
  return declared;
}

/** Asks one procedure with no credential; the root answers whatever the procedure itself says. */
async function ask(api: LiveApi, { path, kind }: DeclaredProcedure): Promise<string> {
  const response =
    kind === "query"
      ? await api.fetch(`/api/trpc/${path}`)
      : await api.fetch(`/api/trpc/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
  return `${response.status} ${await response.text()}`;
}

const NO_SUCH_PROCEDURE = /No procedure found/i;

const database = liveStoresConfigured ? openLivePrisma({ label: "trpc-record" }) : null;
const prisma = database?.prisma as NonNullable<typeof database>["prisma"];
const userIds: string[] = [];
const organizationIds: string[] = [];
const projectIds: string[] = [];

describe.skipIf(!liveStoresConfigured)("the api's tRPC record", () => {
  let api: LiveApi;

  beforeAll(async () => {
    api = await bootLiveApi({ withWorker: true });
  }, 120_000);

  afterAll(async () => {
    await api?.close();
    await removeSeededTraces({ tenantIds: projectIds });
    await removeSignedUpRows({ prisma, userIds, organizationIds });
    await database?.close();
  }, 60_000);

  describe("given every installed module composed the slice it owns", () => {
    /** @scenario "A complete collaborator set mounts the whole record" */
    it("answers every declared namespace on the root, with no procedure absent", async () => {
      const declared = declaredProcedures();
      expect(declared.length).toBeGreaterThan(50);
      expect(new Set(declared.map(({ path }) => path.split(".")[0])).size).toBeGreaterThan(10);

      const control = await ask(api, { path: "noSuchNamespace.noSuchProcedure", kind: "query" });
      expect(control).toMatch(NO_SUCH_PROCEDURE);

      const absent: string[] = [];
      for (const procedure of declared) {
        if (NO_SUCH_PROCEDURE.test(await ask(api, procedure))) absent.push(procedure.path);
      }

      expect(absent).toEqual([]);
    }, 120_000);
  });

  /** Signs a person up and has them found an organization, as the onboarding screen does. */
  async function foundOrganization({ label, orgName }: { label: string; orgName: string }) {
    const session = await signUpSession({ api, label });
    userIds.push(session.userId);
    const created = await callTrpc({
      api,
      path: "organization.createAndAssign",
      kind: "mutation",
      input: { orgName },
      session,
    });
    const { organization, team } = created.data as {
      organization: { id: string; name: string };
      team: { id: string; name: string };
    };
    organizationIds.push(organization.id);
    const project = await seedProject({ prisma, teamId: team.id, label });
    projectIds.push(project.id);

    return { session, organization, team, project };
  }

  describe("given a client watches a long-running export", () => {
    describe("when it opens the subscription path on the process's own server-sent-events lane", () => {
      /** @scenario "A subscription in the record is watchable on the same root" */
      it("connects, carries the published event and completes, on a path the request root also knows", async () => {
        const { session, project } = await foundOrganization({
          label: "watcher",
          orgName: "Watch Co",
        });
        const exportId = `export-${generate("test").toString()}`;
        const input = encodeURIComponent(JSON.stringify({ projectId: project.id, exportId }));
        const response = await api.fetch(`/api/sse/export/onExportProgress?input=${input}`, {
          headers: { ...session.headers, "sec-fetch-site": "same-origin" },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");

        const presence = api.application.service(PresenceApi);
        const publish = setInterval(() => {
          void presence
            .publishProjectEvent({
              projectId: project.id,
              channel: "export_progress",
              event: JSON.stringify({ exportId, type: "done" }),
            })
            .catch(() => undefined);
        }, 250);
        const frames: string[] = [];
        try {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!frames.includes('data: {"type":"complete"}')) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value);
            for (let at = buffer.indexOf("\n\n"); at !== -1; at = buffer.indexOf("\n\n")) {
              frames.push(buffer.slice(0, at));
              buffer = buffer.slice(at + 2);
            }
          }
          await reader.cancel();
        } finally {
          clearInterval(publish);
        }

        expect(frames).toEqual([
          'data: {"type":"connected"}',
          `data: ${JSON.stringify({ exportId, type: "done" })}`,
          'data: {"type":"complete"}',
        ]);
        const onRequestRoot = async (path: string) => {
          const opened = new AbortController();
          const answered = await api.fetch(`/api/trpc/${path}?input=${input}`, {
            headers: session.headers,
            signal: opened.signal,
          });
          opened.abort();
          return answered.status;
        };
        expect(await onRequestRoot("noSuchNamespace.noSuchProcedure")).toBe(404);
        expect(await onRequestRoot("export.onExportProgress")).not.toBe(404);
      }, 30_000);
    });
  });

  describe("given a signed-in person with no organization", () => {
    describe("when the sign-up ceremony runs through the process's own tRPC handler", () => {
      /** @scenario "A new organization is created with its first team" */
      it("writes the organization, its founding membership and its first team, then the founder's grants", async () => {
        const session = await signUpSession({ api, label: "founder" });
        userIds.push(session.userId);
        expect(await prisma.organizationUser.count({ where: { userId: session.userId } })).toBe(0);

        const created = await callTrpc({
          api,
          path: "organization.createAndAssign",
          kind: "mutation",
          input: { orgName: "Founders Inc" },
          session,
        });
        expect(created.status).toBe(200);
        const { organization, team } = created.data as {
          organization: { id: string; name: string };
          team: { id: string };
        };
        organizationIds.push(organization.id);

        const [org, membership, firstTeam, teams, grants] = await Promise.all([
          prisma.organization.findUniqueOrThrow({ where: { id: organization.id } }),
          prisma.organizationUser.findUniqueOrThrow({
            where: {
              userId_organizationId: { userId: session.userId, organizationId: organization.id },
            },
          }),
          prisma.team.findUniqueOrThrow({ where: { id: team.id } }),
          prisma.team.findMany({ where: { organizationId: organization.id } }),
          prisma.grant.findMany({
            where: { organizationId: organization.id, principalId: session.userId },
          }),
        ]);
        expect(org.name).toBe("Founders Inc");
        expect(membership.role).toBe("ADMIN");
        expect(teams.map(({ id }) => id)).toEqual([team.id]);
        expect(firstTeam.organizationId).toBe(organization.id);
        expect(org.createdAt.getTime()).toBeLessThanOrEqual(membership.createdAt.getTime());
        expect(membership.createdAt.getTime()).toBeLessThanOrEqual(firstTeam.createdAt.getTime());

        const held = grants.map(({ scopeType, scopeId, roleKey }) => ({
          scopeType,
          scopeId,
          roleKey,
        }));
        expect(held).toHaveLength(2);
        expect(held).toEqual(
          expect.arrayContaining([
            { scopeType: "ORGANIZATION", scopeId: organization.id, roleKey: "admin" },
            { scopeType: "TEAM", scopeId: team.id, roleKey: "admin" },
          ]),
        );
        for (const grant of grants) {
          expect(grant.createdAt.getTime()).toBeGreaterThanOrEqual(firstTeam.createdAt.getTime());
        }
      }, 90_000);
    });
  });

  describe("given a project whose privacy rules are set at more than one scope", () => {
    describe("when the privacy settings page reads its snapshot through the process's own root", () => {
      /** @scenario "The data privacy snapshot is filtered by what the caller may read" */
      it("resolves the whole cascade, names every rule from the directory and offers only writable scopes", async () => {
        const { session, organization, team, project } = await foundOrganization({
          label: "privacy",
          orgName: "Privacy Co",
        });
        const rule = (scopeType: string, scopeId: string, config: object) =>
          callTrpc({
            api,
            path: "dataPrivacy.setForScope",
            kind: "mutation",
            input: {
              projectId: project.id,
              scope: { scopeType, scopeId },
              personalOnly: false,
              config,
            },
            session,
          });
        expect(
          (await rule("ORGANIZATION", organization.id, { pii: { level: "essential" } })).status,
        ).toBe(200);
        expect((await rule("TEAM", team.id, { pii: { level: "strict" } })).status).toBe(200);
        expect((await rule("PROJECT", project.id, { secrets: { enabled: false } })).status).toBe(
          200,
        );

        const founder = await callTrpc({
          api,
          path: "dataPrivacy.getSnapshot",
          kind: "query",
          input: { projectId: project.id },
          session,
        });
        expect(founder.status).toBe(200);
        const snapshot = founder.data as {
          effective: { pii: { level: string }; secrets: { enabled: boolean } };
          effectiveTeam: { pii: { level: string }; secrets: { enabled: boolean } };
          effectiveOrganization: { pii: { level: string } };
          rules: { scopeType: string; scopeId: string; name: string }[];
          available: {
            organization: { id: string } | null;
            teams: { id: string }[];
            projects: { id: string }[];
          };
        };
        expect(snapshot.effectiveOrganization.pii.level).toBe("essential");
        expect(snapshot.effectiveTeam.pii.level).toBe("strict");
        expect(snapshot.effective.pii.level).toBe("strict");
        expect(snapshot.effective.secrets.enabled).toBe(false);
        expect(snapshot.effectiveTeam.secrets.enabled).toBe(true);
        expect(
          snapshot.rules.map(({ scopeType, scopeId, name }) => ({ scopeType, scopeId, name })),
        ).toEqual(
          expect.arrayContaining([
            { scopeType: "ORGANIZATION", scopeId: organization.id, name: organization.name },
            { scopeType: "TEAM", scopeId: team.id, name: team.name },
            { scopeType: "PROJECT", scopeId: project.id, name: project.name },
          ]),
        );
        expect(snapshot.available.organization?.id).toBe(organization.id);
        expect(snapshot.available.teams.map(({ id }) => id)).toEqual([team.id]);
        expect(snapshot.available.projects.map(({ id }) => id)).toEqual([project.id]);

        const viewer = await signUpSession({ api, label: "privacy-viewer" });
        userIds.push(viewer.userId);
        await prisma.organizationUser.create({
          data: { organizationId: organization.id, userId: viewer.userId, role: "MEMBER" },
        });
        await api.application.service(AuthzApi).attachBindings({
          organizationId: organization.id,
          bindings: [
            {
              bindingId: `rolebinding_${generate("test").toString()}`,
              principal: { userId: viewer.userId },
              role: "VIEWER",
              customRoleId: null,
              scopeType: "PROJECT",
              scopeId: project.id,
            },
          ],
          caller: { type: "system" },
          actor: { type: "system", id: "api-session-fixture" },
          onDuplicate: "skip",
          requireProjection: true,
        });
        const reader = await callTrpc({
          api,
          path: "dataPrivacy.getSnapshot",
          kind: "query",
          input: { projectId: project.id },
          session: viewer,
        });
        expect(reader.status).toBe(200);
        const narrowed = reader.data as { available: typeof snapshot.available };
        expect(narrowed.available.organization).toBeNull();
        expect(narrowed.available.teams).toEqual([]);
        expect(narrowed.available.projects).toEqual([]);
      }, 120_000);
    });
  });

  describe("given a request naming trace ids, only some of which trace storage answers to", () => {
    describe("when the ids are queued for annotation through the process's own root", () => {
      /** @scenario "An id no trace answers to is never queued for review" */
      it("queues only the ids storage answered to", async () => {
        const { session, project } = await foundOrganization({
          label: "annotator",
          orgName: "Annotate Co",
        });
        const known = `trace-known-${generate("test").toString()}`;
        const unknown = `trace-unknown-${generate("test").toString()}`;
        await seedTraceSummary({ tenantId: project.id, traceId: known });
        const queue = await callTrpc({
          api,
          path: "annotation.createOrUpdateQueue",
          kind: "mutation",
          input: {
            projectId: project.id,
            name: "Review",
            description: "",
            userIds: [],
            scoreTypeIds: [],
          },
          session,
        });
        expect(queue.status).toBe(200);
        const queueId = (queue.data as { id: string }).id;

        const queued = await callTrpc({
          api,
          path: "annotation.createQueueItem",
          kind: "mutation",
          input: {
            projectId: project.id,
            traceIds: [known, unknown],
            annotators: [`queue-${queueId}`],
          },
          session,
        });

        expect(queued.status).toBe(200);
        expect(queued.data).toEqual({ created: 1, skipped: 1 });
        const items = await prisma.annotationQueueItem.findMany({
          where: { projectId: project.id },
        });
        expect(items.map(({ traceId }) => traceId)).toEqual([known]);
      }, 90_000);
    });
  });
});
