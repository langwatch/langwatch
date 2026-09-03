/**
 * The SCIM 2.0 provisioning surface through the real Hono app this process
 * mounts, over the REAL directory-sync service `api-scim.composition.ts`
 * builds — only the rows and the collaborators below it are doubles.
 *
 * Driving the real service rather than a fake of it is the point. Fifteen
 * operations were published in the frozen OpenAPI document and answered by
 * nothing for the whole extraction, so what has to be pinned is not that a
 * route exists but that a directory's push reaches the same membership write
 * a person's own invitation acceptance does: the user directory creates the
 * account, `OrganizationUser` records the membership, and the AuthZ grant
 * ledger attaches the organization binding. A fake service would have proved
 * the mount and none of that.
 *
 * The gate CHAIN is the other contract, and its order is deliberate:
 *
 *   bearer (401) → plan (403) → the operation
 *
 * A missing token is 401 before the plan is looked up, and a valid token for
 * an organization that is not on Enterprise is 403 — so a customer with a bad
 * token and one with a lapsed plan get different answers, and neither leaks
 * the other's fact. Three discovery routes sit outside the chain entirely: an
 * identity provider negotiates capabilities before a token exists.
 *
 * Every refusal is `application/scim+json` with a SCIM error envelope, which
 * is what the provider parses; a bare 401 body would be logged by Okta or
 * Entra as a transport failure rather than an authentication one.
 */
import { createHash } from "node:crypto";

import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  EventSourcing,
  type EventSourcedQueueDefinition,
  type EventSourcedQueueProcessor,
  EventStoreProducerOnly,
} from "@langwatch/eventing";
import type { IdentityEventingPort } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";
import { ApiEventingIdentityAdapter } from "../../../app/api-identity-eventing.adapter";
import { composeApiIdentityPipelines } from "../../../app/api-identity-pipelines.composition";
import {
  ApiScimAbsenceReport,
  composeApiScimRest,
  type ApiScimCompositionOptions,
  type ApiScimRestPorts,
} from "../../../app/api-scim.composition";

const ORGANIZATION_ID = "organization-acme";
/** The connection a token is minted against, and the whole of its authority. */
const CONNECTION_ID = "ssoconn_acme";
const TOKEN = "scim-token-value";
const BEARER = `Bearer ${TOKEN}`;
/** The service hashes a presented token before it looks it up, so the rows hold the digest. */
const HASHED_TOKEN = createHash("sha256").update(TOKEN).digest("hex");
const WEBHOOK_SECRET = "auth0-shared-secret";

describe("given a directory holding this organization's SCIM bearer token", () => {
  describe("when it lists the organization's users", () => {
    it("answers the members as SCIM resources, and records the token's use", async () => {
      const world = scimWorld();
      const api = mount(world.ports);

      const response = await api.get("/api/scim/v2/Users", BEARER);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/scim+json");
      await expect(response.json()).resolves.toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 1,
        startIndex: 1,
        itemsPerPage: 100,
        Resources: [
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            id: "user-ada",
            userName: "ada@acme.test",
            name: { givenName: "Ada", familyName: "Lovelace" },
            emails: [{ primary: true, value: "ada@acme.test", type: "work" }],
            active: true,
            meta: {
              resourceType: "User",
              created: "2026-01-01T00:00:00.000Z",
              lastModified: "2026-01-01T00:00:00.000Z",
            },
          },
        ],
      });
      expect(world.database.tokenUses).toEqual(["scim-token-1"]);
    });
  });

  describe("when it provisions a person the organization has never seen", () => {
    it("creates the account, the membership and the organization grant", async () => {
      const world = scimWorld();
      const api = mount(world.ports);

      const response = await api.post(
        "/api/scim/v2/Users",
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "grace@acme.test",
          name: { givenName: "Grace", familyName: "Hopper" },
        },
        BEARER,
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: "user-grace@acme.test",
        userName: "grace@acme.test",
        active: true,
      });
      // The three writes a provisioning push is actually for, in the order the
      // service makes them: the account, then the membership row, then the
      // organization-scoped grant that lets the person see anything at all.
      expect(world.users.created).toEqual([{ name: "Grace Hopper", email: "grace@acme.test" }]);
      expect(world.database.memberships).toContainEqual({
        organizationId: ORGANIZATION_ID,
        userId: "user-grace@acme.test",
        role: "MEMBER",
      });
      expect(world.grants.attached).toEqual([
        {
          organizationId: ORGANIZATION_ID,
          userId: "user-grace@acme.test",
          role: "MEMBER",
          scopeType: "ORGANIZATION",
          scopeId: ORGANIZATION_ID,
          source: "scim",
        },
      ]);
    });
  });

  describe("when the person is already a member of this organization", () => {
    it("answers the SCIM conflict and attaches no second grant", async () => {
      const world = scimWorld();
      const api = mount(world.ports);
      const body = {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "ada@acme.test",
      };

      const response = await api.post("/api/scim/v2/Users", body, BEARER);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "409",
        detail: "User already exists in this organization",
      });
      expect(world.grants.attached).toEqual([]);
    });
  });
});

describe("given a request the directory did not authenticate", () => {
  describe("when the bearer is missing", () => {
    it("answers the SCIM-shaped 401 before the organization's plan is read", async () => {
      const world = scimWorld();
      const api = mount(world.ports);

      const response = await api.get("/api/scim/v2/Users");

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/scim+json");
      await expect(response.json()).resolves.toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "401",
        detail: "Bearer token is required",
      });
      expect(world.planReads).toBe(0);
      expect(world.database.membershipListReads).toBe(0);
    });
  });

  describe("when the bearer is not a token this deployment minted", () => {
    it("answers 401 rather than 403, so a bad token cannot probe a plan", async () => {
      const world = scimWorld();
      const api = mount(world.ports);

      const response = await api.get("/api/scim/v2/Users", "Bearer not-a-token");

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        detail: "Bearer token is not valid",
      });
      expect(world.planReads).toBe(0);
    });
  });
});

describe("given a valid token for an organization that is not on Enterprise", () => {
  describe("when it lists users", () => {
    it("answers 403 with the plan's own message, and reads no member", async () => {
      const world = scimWorld({ planType: "FREE" });
      const api = mount(world.ports);

      const response = await api.get("/api/scim/v2/Users", BEARER);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "403",
      });
      expect(world.database.membershipListReads).toBe(0);
    });
  });
});

describe("given an identity provider negotiating capabilities", () => {
  describe("when it reads the service provider configuration with no credential", () => {
    it("answers, because the negotiation happens before a token exists", async () => {
      const world = scimWorld();
      const api = mount(world.ports);

      const response = await api.get("/api/scim/v2/ServiceProviderConfig");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        patch: { supported: true },
      });
    });
  });
});

describe("given the Auth0 log-stream intake", () => {
  describe("when this deployment configured no shared secret", () => {
    it("answers 404, so a probe cannot learn the path is served here", async () => {
      const world = scimWorld({ webhookSecret: undefined });
      const api = mount(world.ports);

      const response = await api.post("/api/webhooks/auth0-scim", auth0CreateEvent());

      expect(response.status).toBe(404);
      expect(world.users.created).toEqual([]);
    });
  });

  describe("when the presented secret does not match", () => {
    it("answers 401 and provisions nobody", async () => {
      const world = scimWorld();
      const api = mount(world.ports);

      const response = await api.post("/api/webhooks/auth0-scim", auth0CreateEvent(), "wrong");

      expect(response.status).toBe(401);
      expect(world.users.created).toEqual([]);
    });
  });

  describe("when Auth0 presents the configured secret", () => {
    it("provisions the person through the same service the protocol routes use", async () => {
      const world = scimWorld();
      const api = mount(world.ports);

      const response = await api.post(
        "/api/webhooks/auth0-scim",
        auth0CreateEvent(),
        WEBHOOK_SECRET,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ received: true });
      expect(world.users.created).toEqual([{ name: "Grace Hopper", email: "grace@acme.test" }]);
    });
  });
});

describe("given a deployment that composed no Enterprise application", () => {
  describe("when the process mounts its REST families", () => {
    it("serves neither SCIM family, and names the collaborator that decided it", async () => {
      const reasons: string[] = [];
      const report = new RecordingScimAbsence(reasons);

      const ports = composeApiScimRest({
        ...scimWorld().compositionOptions,
        governance: undefined,
        report,
      });
      const api = mount(ports);

      expect(ports).toBeUndefined();
      expect(reasons).toEqual(["Enterprise governance application"]);
      expect((await api.get("/api/scim/v2/Users", BEARER)).status).toBe(404);
      expect((await api.get("/api/scim/v2/ServiceProviderConfig")).status).toBe(404);
      expect(
        (await api.post("/api/webhooks/auth0-scim", auth0CreateEvent(), WEBHOOK_SECRET)).status,
      ).toBe(404);
    });
  });
});

describe("given an API process that registered the directory-sync pipeline producer-only", () => {
  describe("when a directory's push states a fact on the composed SCIM graph", () => {
    /** @scenario "A directory push's history lands on this process's own event stack" */
    it("stages the command on the sender the registration produced, and reports no missing sender", async () => {
      const queue = producerEventing();
      const world = scimWorld({ eventing: queue.eventing });
      const api = mount(world.ports);
      const losses = recordLedgerLosses();

      // The mounted family is real and answers over this same graph: the
      // service the ledger hangs off is the one the fifteen protocol routes
      // are served from, not a second construction.
      expect((await api.get("/api/scim/v2/Users", BEARER)).status).toBe(200);

      await world.ports!.scim().createUser({
        organizationId: ORGANIZATION_ID,
        connectionId: CONNECTION_ID,
        request: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "grace@acme.test",
          name: { givenName: "Grace", familyName: "Hopper" },
        },
      });

      // The one leg this tier has (ADR-110): the staged command, on the
      // `recordScimUserPush` sender `composeApiIdentityPipelines` resolved out
      // of the `scim-sync` registration. Before that registration existed this
      // answered `null`, and the writer swallowed the whole history at
      // `error` — permanently, because the sender was never coming.
      expect(queue.staged).toHaveLength(1);
      expect(queue.staged[0]?.payload).toMatchObject({
        tenantId: ORGANIZATION_ID,
        organizationId: ORGANIZATION_ID,
        connectionId: CONNECTION_ID,
        userId: "user-grace@acme.test",
        op: "create",
      });
      expect(losses.messages).toEqual([]);

      losses.restore();
      await queue.eventSourcing.close();
    });

    /**
     * The registration's OTHER half, and the reason the five names are listed
     * in the composition rather than read off whatever registered: every verb
     * a directory push can state resolves to a sender, so a definition that
     * dropped one would fail this process's boot rather than lose that verb's
     * facts inside one provider's nightly run.
     */
    /** @scenario "A directory push's history lands on this process's own event stack" */
    it("resolves a sender for every verb the directory-sync ledger names", async () => {
      const queue = producerEventing();

      for (const command of [
        "issueScimToken",
        "recordScimUserPush",
        "recordScimGroupMapping",
        "recordScimApplyFailure",
        "revokeScimSync",
      ]) {
        await expect(
          queue.eventing.tryPipelineCommand({ pipeline: "scim-sync", command }),
        ).resolves.not.toBeNull();
      }

      await queue.eventSourcing.close();
    });
  });

  describe("when this process composed no queue at all", () => {
    /** @scenario "A process with no queue loses the directory-sync history loudly" */
    it("lets the push through and records the loss at error, naming the pipeline and the sender", async () => {
      const world = scimWorld();
      const losses = recordLedgerLosses();

      await expect(
        world.ports!.scim().createUser({
          organizationId: ORGANIZATION_ID,
          connectionId: CONNECTION_ID,
          request: {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
            userName: "grace@acme.test",
            name: { givenName: "Grace", familyName: "Hopper" },
          },
        }),
      ).resolves.toMatchObject({ id: "user-grace@acme.test" });

      expect(losses.messages).toHaveLength(1);
      expect(losses.messages[0]).toContain("scim-sync");
      expect(losses.messages[0]).toContain("recordScimUserPush");

      losses.restore();
    });
  });
});

describe("given a directory pushing on a token bound to a connection", () => {
  describe("when the push arrives on the SCIM protocol routes", () => {
    /**
     * A characterization, not an approval. `verifyToken` answers the token's
     * `connectionId` and the protocol door keeps only the organization, so no
     * protocol push carries the connection its own token was minted for — and
     * a directory-sync fact is stated per CONNECTION. So the registration
     * above restores the history for every caller that passes one and changes
     * nothing for these fifteen routes.
     *
     * `specs/identity/scim-connection-sync.feature` holds this as
     * `@unimplemented` ("One connection's token cannot touch another
     * connection's people"); closing it is a write-authority change, not a
     * wiring one, so it is not smuggled in beside a registration.
     */
    it("states no directory-sync fact, because the door forwards no connection", async () => {
      const queue = producerEventing();
      const world = scimWorld({ eventing: queue.eventing });
      const api = mount(world.ports);

      const response = await api.post(
        "/api/scim/v2/Users",
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "grace@acme.test",
          name: { givenName: "Grace", familyName: "Hopper" },
        },
        BEARER,
      );

      expect(response.status).toBe(201);
      expect(queue.staged).toEqual([]);

      await queue.eventSourcing.close();
    });
  });
});

// --------------------------------------------------------------------------

/**
 * This process's own producer-only Eventing, in the shape production composes
 * it: the REAL {@link EventStoreProducerOnly} over a queue that records rather
 * than runs, with `composeApiIdentityPipelines` registering the four packaged
 * definitions on it and handing back the senders it resolved.
 *
 * The store is the production one deliberately — a memory store in that seat
 * accepts an append, holds the event in one process's heap and loses it, which
 * is how a ledger that appended on this tier passed CI for as long as it did.
 * What is faked is Redis, and only Redis.
 */
function producerEventing() {
  const staged: Array<{ queue: string; payload: Record<string, unknown> }> = [];
  const eventSourcing = new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-api" }),
    executionTarget: "api",
    processManagerMode: "producer-only",
    consumersEnabled: false,
    queueFactory: (
      definition: EventSourcedQueueDefinition<Record<string, unknown>>,
    ): EventSourcedQueueProcessor<Record<string, unknown>> => ({
      send: async (payload) => {
        staged.push({ queue: definition.name, payload });
      },
      sendBatch: async () => undefined,
      close: async () => undefined,
      waitUntilReady: async () => undefined,
    }),
  });

  const pipelines = composeApiIdentityPipelines({
    eventing: eventSourcing,
    processName: "langwatch-api",
  });

  return {
    staged,
    eventSourcing,
    eventing: ApiEventingIdentityAdapter.create({ pipelines }),
  };
}

/**
 * Every loss the directory-sync ledger reports while a scenario runs.
 *
 * Its own module logger, which is where the line has to land: the writer
 * SWALLOWS a history it cannot stage, so the log is the only observable the
 * absence has — and asserting it is empty is what makes "the sender exists
 * now" a claim with teeth rather than a silence two bugs could produce.
 */
function recordLedgerLosses() {
  const messages: string[] = [];
  const error = vi
    .spyOn(createLogger("langwatch:identity:scim-sync-ledger"), "error")
    .mockImplementation(((_context: Record<string, unknown>, message: string) => {
      messages.push(message);
    }) as never);

  return { messages, restore: () => error.mockRestore() };
}

/**
 * The rows the composed service reads and writes, and the collaborators
 * underneath it.
 *
 * Doubles at the DATABASE and at the process's own services — never at
 * `ScimService`, which is the thing under test. `as never` at each seam
 * because the real types are Prisma's generated client and four contract
 * classes, and what these scenarios exercise is a handful of members of each.
 */
function scimWorld(
  overrides: {
    planType?: string;
    webhookSecret?: string | undefined;
    /**
     * The event stack the directory-sync history stages through. Defaults to a
     * process that registered no pipeline at all, which is what every scenario
     * above is about — none of them states a directory-sync fact.
     */
    eventing?: IdentityEventingPort;
  } = {},
) {
  const users = {
    created: [] as Array<{ name: string; email: string }>,
    rows: new Map<string, UserRow>([
      [
        "ada@acme.test",
        {
          id: "user-ada",
          name: "Ada Lovelace",
          email: "ada@acme.test",
          deactivatedAt: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    ]),
  };

  const database = {
    tokenUses: [] as string[],
    membershipListReads: 0,
    memberships: [{ organizationId: ORGANIZATION_ID, userId: "user-ada", role: "MEMBER" }],
  };

  const grants = {
    attached: [] as Array<Record<string, unknown>>,
    revoked: [] as string[],
  };

  let planReads = 0;

  const prisma = {
    scimToken: {
      findFirst: ({ where }: { where: { hashedToken: string } }) =>
        Promise.resolve(
          where.hashedToken === HASHED_TOKEN
            ? {
                id: "scim-token-1",
                organizationId: ORGANIZATION_ID,
                connectionId: CONNECTION_ID,
              }
            : null,
        ),
      updateMany: ({ where }: { where: { id: string } }) => {
        database.tokenUses.push(where.id);
        return Promise.resolve({ count: 1 });
      },
    },
    organization: {
      findUnique: ({ where }: { where: { ssoDomain: string } }) =>
        Promise.resolve(where.ssoDomain === "acme.test" ? { id: ORGANIZATION_ID } : null),
    },
    organizationUser: {
      findMany: () => {
        database.membershipListReads += 1;
        return Promise.resolve(
          database.memberships.map((membership) => ({
            ...membership,
            user: userById(users.rows, membership.userId),
          })),
        );
      },
      count: () => Promise.resolve(database.memberships.length),
      findUnique: ({
        where,
      }: {
        where: { userId_organizationId: { userId: string; organizationId: string } };
      }) => {
        const found = database.memberships.find(
          (membership) =>
            membership.userId === where.userId_organizationId.userId &&
            membership.organizationId === where.userId_organizationId.organizationId,
        );
        return Promise.resolve(
          found ? { ...found, user: userById(users.rows, found.userId) } : null,
        );
      },
      create: ({ data }: { data: { organizationId: string; userId: string; role: string } }) => {
        database.memberships.push({ ...data, role: "MEMBER" });
        return Promise.resolve(data);
      },
    },
    roleBinding: { findMany: () => Promise.resolve([]) },
    // Present because the repository refuses a connection that names no SCIM
    // model, and refusing because no scenario here pushes a directory group.
    group: { findFirst: unreachedModel("group") },
    groupMembership: { findMany: unreachedModel("groupMembership") },
    ssoConnection: { findFirst: unreachedModel("ssoConnection") },
    scimExternalId: {
      findUnique: () => Promise.resolve(null),
      findMany: () => Promise.resolve([]),
      upsert: () => Promise.resolve({}),
    },
    // The directory-sync head the guards read before they state a fact. Empty:
    // every scenario here is a connection's FIRST push, so the guard states
    // the fact and no recovery beside it.
    scimSyncState: {
      findUnique: () => Promise.resolve(null),
      findFirst: () => Promise.resolve(null),
    },
  };

  const compositionOptions: ApiScimCompositionOptions = {
    prisma: prisma as never,
    grants: {
      attachBindings: ({
        organizationId,
        bindings,
        source,
      }: {
        organizationId: string;
        bindings: Array<{
          principal: { userId?: string };
          role: string;
          scopeType: string;
          scopeId: string;
        }>;
        source: string;
      }) => {
        for (const binding of bindings) {
          grants.attached.push({
            organizationId,
            userId: binding.principal.userId,
            role: binding.role,
            scopeType: binding.scopeType,
            scopeId: binding.scopeId,
            source,
          });
        }
        return Promise.resolve();
      },
      revokeBindings: ({ bindingIds }: { bindingIds: string[] }) => {
        grants.revoked.push(...bindingIds);
        return Promise.resolve();
      },
    } as never,
    users: {
      tryFindByEmail: ({ email }: { email: string }) =>
        Promise.resolve(users.rows.get(email) ?? null),
      tryFindById: ({ id }: { id: string }) =>
        Promise.resolve([...users.rows.values()].find((row) => row.id === id) ?? null),
      create: ({ name, email }: { name: string; email: string }) => {
        users.created.push({ name, email });
        const row: UserRow = {
          id: `user-${email}`,
          name,
          email,
          deactivatedAt: null,
          createdAt: new Date("2026-02-02T00:00:00.000Z"),
          updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        };
        users.rows.set(email, row);
        return Promise.resolve(row);
      },
    } as never,
    auth: {
      revokeAllBrowserSessions: () => Promise.resolve(),
    } as never,
    // Present, and never called by these scenarios: a cost centre only reaches
    // the department owner when the directory pushes the attribute.
    governance: {
      departmentAssignUser: () => Promise.reject(new Error("no cost centre in these pushes")),
      departmentResolveByNameOrCreate: () =>
        Promise.reject(new Error("no cost centre in these pushes")),
    } as never,
    plans: {
      getActivePlan: () => {
        planReads += 1;
        return Promise.resolve({ type: overrides.planType ?? "ENTERPRISE" });
      },
    } as never,
    // No queue on this composition unless a scenario supplies one: the
    // directory-sync history says so, at `error` and by name, and returns
    // rather than failing the push — which is the package's own rule.
    eventing:
      overrides.eventing ??
      ({
        tryPipelineCommand: () => Promise.resolve(null),
      } as never),
    provenOffboarding: false,
    auth0WebhookSecret: "webhookSecret" in overrides ? overrides.webhookSecret : WEBHOOK_SECRET,
  };

  return {
    users,
    database,
    grants,
    compositionOptions,
    get planReads() {
      return planReads;
    },
    ports: composeApiScimRest(compositionOptions),
  };
}

/** Collects the absence reason so the OSS scenario can name it. */
class RecordingScimAbsence extends ApiScimAbsenceReport {
  constructor(private readonly reasons: string[]) {
    super();
  }

  absent(because: string): void {
    this.reasons.push(because);
  }
}

/** A model the composed service must hold but no scenario here reads. */
function unreachedModel(model: string): () => Promise<never> {
  return () => Promise.reject(new Error(`no scenario here reads ${model}`));
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function userById(rows: Map<string, UserRow>, userId: string): UserRow {
  const row = [...rows.values()].find((candidate) => candidate.id === userId);
  if (!row) throw new Error(`no user row for ${userId}`);
  return row;
}

/** One Auth0 SCIM log-stream event: a provisioning create for grace@acme.test. */
function auth0CreateEvent() {
  return {
    type: "sscim",
    description: "SCIM create user",
    details: {
      operation: "create",
      body: {
        userName: "grace@acme.test",
        name: { givenName: "Grace", familyName: "Hopper" },
      },
    },
  };
}

function mount(scim: ApiScimRestPorts | undefined) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the SCIM families resolve their own credential.");
      },
      rateLimit: async () => ({ allowed: true }),
      ...(scim ? { scim } : {}),
    },
  })) {
    hono.route("/", app);
  }

  const fetchAt = (path: string, init?: RequestInit) =>
    hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    get: (path: string, authorization?: string) =>
      fetchAt(path, authorization ? { headers: { authorization } } : undefined),
    post: (path: string, body: unknown, authorization?: string) =>
      fetchAt(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { authorization } : {}),
        },
        body: JSON.stringify(body),
      }),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A SCIM family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
