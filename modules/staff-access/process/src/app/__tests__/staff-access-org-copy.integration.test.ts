/**
 * The organization copy through the staff access module, against Postgres when
 * `LANGWATCH_TEST_DATABASE_URL` names one and against the memory twins always. The copied
 * modules are in-memory stand-ins (support/copy-catalog.ts) reached only through their `*Api`.
 * @see modules/staff-access/specs/staff-access-org-copy.feature
 */
import { ClientAddress } from "@langwatch/api/policy";
import type { StaffAccessScope } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { StaffAccessDoorSession } from "@langwatch/staff-access-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import { PostgresStaffAccessRepositories } from "../../repositories/prisma/prisma.staff-access.repositories.ts";
import type { StaffAccessRepositories } from "../../repositories/staff-access.repositories.ts";
import {
  ACME,
  AGENT_IP,
  GLOBEX,
  INITECH,
  OLIVIA,
  PEDRO,
  requestBody,
  staffAccessWorld,
  VERIFIER,
  type StaffAccessWorld,
} from "./support/staff-access-world.ts";

type Backend = Readonly<{ name: string; repositories: () => StaffAccessRepositories }>;
type Organization = typeof ACME;
type Agent = Awaited<ReturnType<StaffAccessWorld["enrol"]>>;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function requestFrom({ bearer }: { bearer: string }): Request {
  const request = new Request("https://app.langwatch.test/api/staff-access/ops/copies", {
    headers: { authorization: `Bearer ${bearer}`, "user-agent": "langwatch-cli" },
  });
  ClientAddress.fromTrustedProxies({}).handle({ request, socketAddress: AGENT_IP });
  return request;
}

/** A request approved by Olivia with the organization's name typed, then redeemed. */
async function liveApproval({
  w,
  agent,
  scopes,
  organization,
  counterpart,
}: {
  w: StaffAccessWorld;
  agent: Agent;
  scopes: StaffAccessScope[];
  organization: Organization;
  counterpart?: Organization;
}): Promise<{
  requestId: string;
  opsToken: string;
  apiKey: string | undefined;
  session: StaffAccessDoorSession;
}> {
  const created = await w.app.createRequest({
    session: agent.session,
    body: requestBody({
      scopes,
      organization: organization.slug,
      ...(counterpart ? { counterpartOrganization: counterpart.slug } : {}),
    }),
  });
  await w.approve({
    choice: {
      requestId: created.requestId,
      spendApproved: false,
      typedOrganizationName: organization.name,
    },
  });
  const answer = await w.app.redeem({
    session: agent.session,
    requestId: created.requestId,
    codeVerifier: VERIFIER,
  });
  const opsToken = answer.opsToken ?? "";
  const caller = await w.app.staffAccessDoor.identify?.({
    request: requestFrom({ bearer: opsToken }),
  });
  return {
    requestId: created.requestId,
    opsToken,
    apiKey: answer.apiKey,
    session: caller?.session as StaffAccessDoorSession,
  };
}

/** ACME with one project: an evaluator, a monitor on it, a two-version prompt and a dataset. */
function seedAcme(w: StaffAccessWorld) {
  const project = w.copy.addProject({ organizationId: ACME.id, name: "support-bot" });
  const evaluator = w.copy.addEvaluator({ projectId: project.id, name: "Exact match" });
  const monitor = w.copy.addMonitor({
    projectId: project.id,
    name: "Answers match",
    evaluatorId: evaluator.id,
  });
  const promptId = w.copy.addPrompt({
    projectId: project.id,
    organizationId: ACME.id,
    handle: "support-reply",
    texts: ["first", "second"],
  });
  const dataset = w.copy.addDataset({ projectId: project.id, name: "Golden answers" });
  return { project, evaluator, monitor, promptId, dataset };
}

/** Live source (ACME) and target (Globex) approvals from one agent. */
async function pairedApprovals(w: StaffAccessWorld) {
  const agent = await w.enrol();
  const source = await liveApproval({
    w,
    agent,
    scopes: ["copy:source"],
    organization: ACME,
    counterpart: GLOBEX,
  });
  const target = await liveApproval({
    w,
    agent,
    scopes: ["copy:target"],
    organization: GLOBEX,
    counterpart: ACME,
  });
  return { agent, source, target };
}

function scenarios(backend: Backend): void {
  const world = () => staffAccessWorld({ repositories: backend.repositories() });

  describe(`given the ${backend.name} store`, () => {
    describe("when an operator approves a copy request", () => {
      /** @scenario "A copy approval needs the organization name typed" */
      it("refuses an approval without the typed organization name", async () => {
        const w = world();
        const agent = await w.enrol();
        const created = await w.app.createRequest({
          session: agent.session,
          body: requestBody({
            scopes: ["copy:target"],
            organization: GLOBEX.slug,
            counterpartOrganization: ACME.slug,
          }),
        });

        await expect(
          codeOf(w.approve({ choice: { requestId: created.requestId, spendApproved: false } })),
        ).resolves.toBe("organization_name_mismatch");
      });
    });

    describe("when the door is asked opsCopy:create", () => {
      /** @scenario "The door answers opsCopy:create only for a session approved for copy:target" */
      it("permits a copy:target session and refuses copy:source and ops:read ones", async () => {
        const w = world();
        const agent = await w.enrol();
        const copy = await liveApproval({
          w,
          agent,
          scopes: ["copy:target"],
          organization: GLOBEX,
          counterpart: ACME,
        });
        const source = await liveApproval({
          w,
          agent,
          scopes: ["copy:source"],
          organization: ACME,
          counterpart: GLOBEX,
        });
        const read = await liveApproval({ w, agent, scopes: ["ops:read"], organization: ACME });
        const door = w.app.staffAccessDoor;
        const ask = (
          session: StaffAccessDoorSession,
          permission: "opsCopy:create" | "opsRead:view",
        ) =>
          door.authorizePlatform?.({
            caller: { actor: null, scope: null, session } as never,
            permission,
          });

        expect(ask(copy.session, "opsCopy:create")).toEqual({ permitted: true });
        expect(ask(copy.session, "opsRead:view")).toEqual({ permitted: false });
        expect(ask(read.session, "opsCopy:create")).toEqual({ permitted: false });
        expect(ask(source.session, "opsCopy:create")).toEqual({ permitted: false });
      });
    });

    describe("when the agent copies ACME into Globex", () => {
      /** @scenario "A copy makes the source's projects and their setup in the target" */
      it("makes a new project with its evaluator, paused monitor, prompt versions and dataset", async () => {
        const w = world();
        const seeded = seedAcme(w);
        const { source, target } = await pairedApprovals(w);

        const report = await w.app.copyOrganization({
          session: target.session,
          body: { sourceOpsToken: source.opsToken, projects: [seeded.project.id] },
        });

        const copiedProject = w.copy.data.projects.find(
          (project) => project.organizationId === GLOBEX.id,
        );
        expect(copiedProject).toBeDefined();
        expect(copiedProject?.id).not.toBe(seeded.project.id);
        expect(copiedProject?.slug).not.toBe(seeded.project.slug);
        const made = w.copy.inProject(copiedProject?.id ?? "");
        expect(made.evaluators.map((evaluator) => evaluator.name)).toEqual(["Exact match"]);
        expect(made.monitors).toEqual([
          expect.objectContaining({
            name: "Answers match",
            evaluatorId: made.evaluators[0]?.id,
            enabled: false,
          }),
        ]);
        expect(made.prompts.map((prompt) => [prompt.version, prompt.prompt])).toEqual([
          [1, "first"],
          [2, "second"],
        ]);
        expect(made.datasets.map((dataset) => dataset.name)).toEqual(["Golden answers"]);
        expect(report.items.map((item) => [item.kind, item.outcome])).toEqual([
          ["project", "copied"],
          ["evaluator", "copied"],
          ["monitor", "copied"],
          ["prompt", "copied"],
          ["dataset", "copied"],
        ]);
        expect(report.totals.copied).toBe(5);
        expect(report.target).toEqual({ id: GLOBEX.id, slug: GLOBEX.slug, name: GLOBEX.name });
      });

      /** @scenario "A dry run lists what a copy would make and copies nothing" */
      it("plans every item and creates nothing on a dry run", async () => {
        const w = world();
        const seeded = seedAcme(w);
        const { source, target } = await pairedApprovals(w);

        const report = await w.app.copyOrganization({
          session: target.session,
          body: { sourceOpsToken: source.opsToken, projects: [seeded.project.id], dryRun: true },
        });

        expect(report.dryRun).toBe(true);
        expect(report.items.every((item) => item.outcome === "planned")).toBe(true);
        expect(report.totals.planned).toBe(5);
        expect(w.copy.data.projects.some((project) => project.organizationId === GLOBEX.id)).toBe(
          false,
        );
        expect(w.state.audit.some((row) => row.action === "staffAccess.orgCopy")).toBe(false);
      });

      /** @scenario "A dry run is in both organizations' audit logs as a planned copy" */
      it("writes a planned-copy audit row in each organization on a dry run", async () => {
        const w = world();
        const seeded = seedAcme(w);
        const { source, target } = await pairedApprovals(w);

        await w.app.copyOrganization({
          session: target.session,
          body: { sourceOpsToken: source.opsToken, projects: [seeded.project.id], dryRun: true },
        });

        const rows = w.state.audit.filter((row) => row.action === "staffAccess.orgCopyPlanned");
        expect(rows.map((row) => row.organizationId)).toEqual([ACME.id, GLOBEX.id]);
        expect(rows[0]?.metadata).toMatchObject({
          approvedBy: { id: OLIVIA },
          items: expect.arrayContaining(["project: support-bot", "prompt: support-reply"]),
        });
      });

      /** @scenario "A revoked approval stops a running copy" */
      it("stops at the next item once the source session is revoked mid-run", async () => {
        const w = world();
        const seeded = seedAcme(w);
        const { source, target } = await pairedApprovals(w);
        w.copy.hooks.beforeEvaluatorCreate = async () => {
          await w.app.revokeSession({ ...w.operator(OLIVIA), requestId: source.requestId });
        };

        const report = await w.app.copyOrganization({
          session: target.session,
          body: { sourceOpsToken: source.opsToken, projects: [seeded.project.id] },
        });

        expect(report.stoppedBecause).toBe("source_approval_ended");
        expect(report.items.map((item) => [item.kind, item.outcome])).toEqual([
          ["project", "copied"],
          ["evaluator", "copied"],
          ["monitor", "stopped"],
          ["prompt", "stopped"],
          ["dataset", "stopped"],
        ]);
        expect(report.totals.stopped).toBe(3);
        expect(
          w.copy.data.datasets.filter((dataset) => dataset.projectId !== seeded.project.id),
        ).toEqual([]);
        const stopped = w.state.audit.filter((row) => row.action === "staffAccess.orgCopyStopped");
        expect(stopped.map((row) => row.organizationId)).toEqual([ACME.id, GLOBEX.id]);
        expect(stopped[0]?.metadata).toMatchObject({ stoppedBecause: "source_approval_ended" });
      });

      /** @scenario "A rerun copies only what is new" */
      it("copies only the prompt added since the first copy", async () => {
        const w = world();
        const seeded = seedAcme(w);
        const { source, target } = await pairedApprovals(w);
        const body = { sourceOpsToken: source.opsToken, projects: [seeded.project.id] };
        await w.app.copyOrganization({ session: target.session, body });
        w.copy.addPrompt({
          projectId: seeded.project.id,
          organizationId: ACME.id,
          handle: "escalation",
          texts: ["escalate"],
        });

        const rerun = await w.app.copyOrganization({ session: target.session, body });

        expect(rerun.items.filter((item) => item.outcome === "copied")).toEqual([
          expect.objectContaining({ kind: "prompt", name: "escalation" }),
        ]);
        expect(rerun.totals.already_copied).toBe(5);
        expect(
          w.copy.data.projects.filter((project) => project.organizationId === GLOBEX.id),
        ).toHaveLength(1);
      });

      /** @scenario "Kinds a copy cannot carry yet are skipped with a reason" */
      it("skips a workflow evaluator and an experiment monitor with their reasons", async () => {
        const w = world();
        const project = w.copy.addProject({ organizationId: ACME.id, name: "lab" });
        w.copy.addEvaluator({ projectId: project.id, name: "Studio judge", type: "workflow" });
        w.copy.addMonitor({
          projectId: project.id,
          name: "Experiment check",
          evaluatorId: null,
          experimentId: "experiment_1",
        });
        const { source, target } = await pairedApprovals(w);

        const report = await w.app.copyOrganization({
          session: target.session,
          body: { sourceOpsToken: source.opsToken, projects: [project.id] },
        });

        expect(report.items.filter((item) => item.outcome === "skipped")).toEqual([
          expect.objectContaining({ kind: "evaluator", reason: "workflow_evaluator" }),
          expect.objectContaining({ kind: "monitor", reason: "experiment_monitor" }),
        ]);
      });

      /** @scenario "A copy writes both trails and both organizations' audit logs before it copies" */
      it("writes a trail row on each approval and an audit row in each organization", async () => {
        const w = world();
        const seeded = seedAcme(w);
        const { source, target } = await pairedApprovals(w);

        await w.app.copyOrganization({
          session: target.session,
          body: { sourceOpsToken: source.opsToken, projects: [seeded.project.id] },
        });

        for (const requestId of [source.requestId, target.requestId]) {
          const trail = await w.repositories.events.findByRequest({ requestId });
          expect(trail).toEqual([
            expect.objectContaining({
              operation: "staffAccess.copyOrganization",
              permissions: ["opsCopy:create"],
              status: 200,
            }),
          ]);
        }
        const rows = w.state.audit.filter((row) => row.action === "staffAccess.orgCopy");
        expect(rows.map((row) => row.organizationId)).toEqual([ACME.id, GLOBEX.id]);
        expect(rows[0]?.metadata).toMatchObject({
          principal: "LangWatch Support",
          approvedBy: { id: OLIVIA },
          reason: "fix ACME's broken evaluator",
          counts: { project: 1, evaluator: 1, monitor: 1, prompt: 1, dataset: 1 },
          items: expect.arrayContaining(["project: support-bot", "prompt: support-reply"]),
          monitorsCreatedPaused: true,
        });
      });

      /** @scenario "A failed audit write copies nothing" */
      it("refuses with staff_access_audit_unavailable and creates nothing", async () => {
        const w = world();
        const seeded = seedAcme(w);
        const { source, target } = await pairedApprovals(w);
        w.state.auditRefused = true;

        const refused = await codeOf(
          w.app.copyOrganization({
            session: target.session,
            body: { sourceOpsToken: source.opsToken, projects: [seeded.project.id] },
          }),
        );

        expect(refused).toBe("staff_access_audit_unavailable");
        expect(w.copy.data.projects.some((project) => project.organizationId === GLOBEX.id)).toBe(
          false,
        );
      });
    });

    describe("when the agent redeems the copy approvals", () => {
      /** @scenario "A copy approval mints only an ops token, never an organization key" */
      it("answers an ops token and no organization key for either side", async () => {
        const w = world();
        const { source, target } = await pairedApprovals(w);

        expect(source.opsToken).toMatch(/^lwsa_/);
        expect(target.opsToken).toMatch(/^lwsa_/);
        expect(source.apiKey).toBeUndefined();
        expect(target.apiKey).toBeUndefined();
        expect(w.state.minted).toEqual([]);
      });

      /** @scenario "The approval page shows the other organization and the target grant" */
      it("shows the counterpart on both sides and the grant on the target only", async () => {
        const w = world();
        const agent = await w.enrol();
        const ask = async (
          scopes: StaffAccessScope[],
          organization: Organization,
          other: Organization,
        ) => {
          const created = await w.app.createRequest({
            session: agent.session,
            body: requestBody({
              scopes,
              organization: organization.slug,
              counterpartOrganization: other.slug,
            }),
          });
          return w.app.getApprovalRequest({ ...w.operator(OLIVIA), requestId: created.requestId });
        };

        const sourceView = await ask(["copy:source"], ACME, GLOBEX);
        const targetView = await ask(["copy:target"], GLOBEX, ACME);

        expect(sourceView).toMatchObject({
          organizationName: ACME.name,
          counterpartOrganizationName: GLOBEX.name,
        });
        expect(sourceView.copyGrant).toEqual([]);
        expect(targetView).toMatchObject({
          organizationName: GLOBEX.name,
          counterpartOrganizationName: ACME.name,
        });
        expect(targetView.copyGrant).toEqual(
          expect.arrayContaining(["project:create", "prompts:create", "datasets:create"]),
        );
      });
    });

    describe("when the two approvals do not pair", () => {
      /** @scenario "A copy with a source token that is no session is refused" */
      it("refuses a source token the server never issued", async () => {
        const w = world();
        const { target } = await pairedApprovals(w);

        await expect(
          codeOf(
            w.app.copyOrganization({
              session: target.session,
              body: { sourceOpsToken: "lwsa_unknownlookup_notasecret" },
            }),
          ),
        ).resolves.toBe("staff_copy_source_invalid");
        await expect(
          codeOf(
            w.app.copyOrganization({
              session: target.session,
              body: { sourceOpsToken: "sk-lw-not-an-ops-token" },
            }),
          ),
        ).resolves.toBe("staff_copy_source_invalid");
      });

      /** @scenario "A source approval that is no longer live does not pair with a new target approval" */
      it("refuses once the source approval's hour ran out", async () => {
        const w = world();
        const agent = await w.enrol();
        const source = await liveApproval({
          w,
          agent,
          scopes: ["copy:source"],
          organization: ACME,
          counterpart: GLOBEX,
        });
        w.advance({ minutes: 50 });
        const target = await liveApproval({
          w,
          agent,
          scopes: ["copy:target"],
          organization: GLOBEX,
          counterpart: ACME,
        });
        w.advance({ minutes: 15 });

        await expect(
          codeOf(
            w.app.copyOrganization({
              session: target.session,
              body: { sourceOpsToken: source.opsToken },
            }),
          ),
        ).resolves.toBe("staff_copy_window_closed");
      });

      /** @scenario "Approvals from different agents do not pair" */
      it("refuses a source approved for another enrolled agent", async () => {
        const w = world();
        const first = await w.enrol();
        const second = await w.enrol({ name: "second agent" });
        const source = await liveApproval({
          w,
          agent: second,
          scopes: ["copy:source"],
          organization: ACME,
          counterpart: GLOBEX,
        });
        const target = await liveApproval({
          w,
          agent: first,
          scopes: ["copy:target"],
          organization: GLOBEX,
          counterpart: ACME,
        });

        await expect(
          codeOf(
            w.app.copyOrganization({
              session: target.session,
              body: { sourceOpsToken: source.opsToken },
            }),
          ),
        ).resolves.toBe("staff_copy_approvals_mismatch");
      });

      /** @scenario "Each side needs its own copy scope" */
      it("refuses an ops:read source and a target approved as a copy source", async () => {
        const w = world();
        const agent = await w.enrol();
        const readSource = await liveApproval({
          w,
          agent,
          scopes: ["ops:read"],
          organization: ACME,
        });
        const source = await liveApproval({
          w,
          agent,
          scopes: ["copy:source"],
          organization: ACME,
          counterpart: GLOBEX,
        });
        const target = await liveApproval({
          w,
          agent,
          scopes: ["copy:target"],
          organization: GLOBEX,
          counterpart: ACME,
        });
        const sourceAsTarget = await liveApproval({
          w,
          agent,
          scopes: ["copy:source"],
          organization: GLOBEX,
          counterpart: ACME,
        });

        await expect(
          codeOf(
            w.app.copyOrganization({
              session: target.session,
              body: { sourceOpsToken: readSource.opsToken },
            }),
          ),
        ).resolves.toBe("staff_copy_scope_missing");
        await expect(
          codeOf(
            w.app.copyOrganization({
              session: sourceAsTarget.session,
              body: { sourceOpsToken: source.opsToken },
            }),
          ),
        ).resolves.toBe("staff_copy_scope_missing");
      });

      /** @scenario "Approvals that do not name each other do not pair" */
      it("refuses a source approved for a copy into another organization", async () => {
        const w = world();
        const agent = await w.enrol();
        const source = await liveApproval({
          w,
          agent,
          scopes: ["copy:source"],
          organization: GLOBEX,
          counterpart: INITECH,
        });
        const target = await liveApproval({
          w,
          agent,
          scopes: ["copy:target"],
          organization: ACME,
          counterpart: GLOBEX,
        });

        await expect(
          codeOf(
            w.app.copyOrganization({
              session: target.session,
              body: { sourceOpsToken: source.opsToken },
            }),
          ),
        ).resolves.toBe("staff_copy_direction_mismatch");
      });

      /** @scenario "A copy request naming one organization on both sides is refused" */
      it("refuses a copy request whose counterpart is its own organization", async () => {
        const w = world();
        const agent = await w.enrol();

        await expect(
          codeOf(
            w.app.createRequest({
              session: agent.session,
              body: requestBody({
                scopes: ["copy:source"],
                organization: ACME.slug,
                counterpartOrganization: ACME.slug,
              }),
            }),
          ),
        ).resolves.toBe("staff_copy_same_organization");
      });
    });
  });
}

describe("StaffAccessModule organization copy", () => {
  scenarios({ name: "memory", repositories: () => MemoryStaffAccessRepositories.create() });
});

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("staff-access-copy-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

/** Every row these tests write belongs to the two test operators. */
async function removeTestRows(): Promise<void> {
  const prisma = connection?.client;
  if (!prisma) return;
  const owners = { in: [OLIVIA, PEDRO] };
  const requests = await prisma.staffAccessRequest.findMany({
    where: { ownerUserId: owners },
    select: { id: true },
  });
  const requestIds = { in: requests.map((request) => request.id) };
  await prisma.staffAccessCopyLedger.deleteMany({ where: { requestId: requestIds } });
  await prisma.staffAccessEvent.deleteMany({ where: { requestId: requestIds } });
  await prisma.staffAccessRequest.deleteMany({ where: { ownerUserId: owners } });
  await prisma.staffAccessRequester.deleteMany({ where: { ownerUserId: owners } });
  await prisma.staffAccessChallenge.deleteMany({ where: { userId: owners } });
}

describe.skipIf(!connection)("StaffAccessModule organization copy on Postgres", () => {
  beforeAll(removeTestRows);
  afterAll(async () => {
    await removeTestRows();
    await connection?.client.$disconnect();
  });

  scenarios({
    name: "Postgres",
    repositories: () => {
      if (!connection) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
      return PostgresStaffAccessRepositories.create({ prisma: connection.client });
    },
  });
});
