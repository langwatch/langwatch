/**
 * Main's authz declaration sweep (ADR-092 decision 25), ported over the typed tRPC
 * declarations: every scope id a procedure accepts is checked at its own tier or claimed.
 * @vitest-environment node
 * @see specs/rbac/typed-permission-declarations.feature
 */
import {
  type AuthzPermission,
  isPlatformTierPermission,
  permissionGrantTiers,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "@langwatch/authorization";
import { defineTrpcContract, moduleApi, type TrpcContract } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { permissionsOfChoice } from "../../access/input-permission.ts";
import {
  defineTrpcRouter,
  type TrpcAccess,
  type TrpcProcedureRequest,
  type TrpcRouterDeclaration,
} from "../runtime.ts";

const SCOPE_FIELDS = Object.values(SCOPE_TIER_FIELDS) as ScopeTierField[];

type ScopeFieldSets = { required: ScopeTierField[]; accepted: ScopeTierField[] };

type SweptProcedure = Readonly<{
  path: string;
  access: TrpcAccess;
  fields: ScopeFieldSets;
  opaqueInput: boolean;
}>;

type ZodDef = { type: string } & Record<string, unknown>;

function defOf(schema: unknown): ZodDef | undefined {
  return (schema as { _zod?: { def?: ZodDef } } | undefined)?._zod?.def;
}

/** Strip the wrappers a parser may sit behind before its shape is readable. */
function unwrap(schema: unknown): unknown {
  let current = schema;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = defOf(current);
    if (!def) break;
    const inner = def.innerType ?? (def.type === "pipe" ? def.in : undefined);
    if (inner === undefined) break;
    current = inner;
  }
  return current;
}

/** Only an optional field can be absent: a defaulted or nullable id still reaches the handler. */
function isAbsentable(field: unknown): boolean {
  const def = defOf(field);
  if (def?.type === "optional") return true;
  if (def?.type === "union") return (def.options as unknown[]).some(isAbsentable);
  return def?.type === "undefined";
}

/** The scope fields one parser requires and accepts; null when the schema cannot be read. */
function scopeFieldsOf(parser: unknown): ScopeFieldSets | null {
  const schema = unwrap(parser);
  const def = defOf(schema);
  if (def?.type === "void" || def?.type === "undefined") return { required: [], accepted: [] };

  if (def?.type === "union") {
    const members = (def.options as unknown[]).map(scopeFieldsOf);
    if (members.some((member) => member === null)) return null;
    const [first, ...rest] = members as ScopeFieldSets[];
    if (!first) return { required: [], accepted: [] };
    return {
      required: first.required.filter((field) => rest.every((m) => m.required.includes(field))),
      accepted: [...new Set(members.flatMap((member) => member?.accepted ?? []))],
    };
  }

  if (def?.type === "intersection") {
    const sides = [scopeFieldsOf(def.left), scopeFieldsOf(def.right)];
    if (sides.some((side) => side === null)) return null;
    return {
      required: [...new Set(sides.flatMap((side) => side?.required ?? []))],
      accepted: [...new Set(sides.flatMap((side) => side?.accepted ?? []))],
    };
  }

  if (def?.type !== "object") return null;
  const shape = def.shape as Record<string, unknown>;
  return {
    required: SCOPE_FIELDS.filter((field) => field in shape && !isAbsentable(shape[field])),
    accepted: SCOPE_FIELDS.filter((field) => field in shape),
  };
}

/** The ids one check covers: the narrowest present tier, or every id at the organization. */
function forPermission({
  permission,
  present,
  via,
}: {
  permission: AuthzPermission;
  present: ScopeTierField[];
  via?: ScopeTierField;
}): ScopeTierField[] {
  if (via) return [via];
  if (isPlatformTierPermission(permission)) return present;
  const tier = permissionGrantTiers(permission).find((candidate) =>
    present.includes(SCOPE_TIER_FIELDS[candidate]),
  );
  if (!tier) return [];
  // The scope lineage guard anchors every narrower id to the organization the check resolved.
  if (tier === "organization") return present;
  return [SCOPE_TIER_FIELDS[tier]];
}

/** Every scope field the procedure's declaration proves, judged as the runtime resolves it. */
function coveredScopeFields({
  access,
  required,
  accepted,
}: {
  access: TrpcAccess;
  required: ScopeTierField[];
  accepted: ScopeTierField[];
}): ScopeTierField[] {
  switch (access.kind) {
    case "permission":
      return forPermission({ permission: access.permission, present: accepted, via: access.via });
    case "permission-any":
    case "permission-all":
      return access.permissions.flatMap((permission) =>
        forPermission({
          permission,
          present: accepted,
          via: "via" in access ? access.via : undefined,
        }),
      );
    case "permission-by-input":
      return permissionsOfChoice(access).flatMap((permission) =>
        forPermission({ permission, present: accepted, via: access.via }),
      );
    case "permission-platform":
      return accepted;
    case "service-authorized":
      return [
        ...access.permissions.flatMap((permission) =>
          forPermission({ permission, present: required }),
        ),
        ...(Object.keys(access.enforces ?? {}) as ScopeTierField[]),
      ];
    case "no-permission":
      return Object.keys(access.allow ?? {}) as ScopeTierField[];
    case "public":
      return [];
  }
}

/** Mounts each declaration on a runtime that only records what every procedure declares. */
function collectProcedures(
  declarations: readonly TrpcRouterDeclaration<unknown, TrpcContract>[],
): SweptProcedure[] {
  const swept: SweptProcedure[] = [];
  for (const declaration of declarations) {
    declaration.router(
      {
        procedure: (request: TrpcProcedureRequest<object>) => {
          const fields = scopeFieldsOf(request.member.input);
          swept.push({
            path: request.procedure,
            access: request.access,
            fields: fields ?? { required: [], accepted: [] },
            opaqueInput: fields === null,
          });
          return request;
        },
        router: (record) => record,
      },
      () => ({}),
    );
  }
  return swept;
}

/** What the sweep refuses: unchecked ids, stale claims, unresolvable checks, unreadable inputs. */
function sweep(procedures: readonly SweptProcedure[]) {
  const covered = (procedure: SweptProcedure) =>
    coveredScopeFields({ access: procedure.access, ...procedure.fields });

  return {
    unchecked: procedures.flatMap((procedure) =>
      procedure.fields.required
        .filter((field) => !covered(procedure).includes(field))
        .map((field) => `${procedure.path} accepts ${field} unchecked`),
    ),
    staleClaims: procedures.flatMap(({ path, access, fields }) =>
      access.kind === "service-authorized"
        ? (Object.keys(access.enforces ?? {}) as ScopeTierField[])
            .filter((field) => !fields.accepted.includes(field))
            .map((field) => `${path} claims to enforce ${field}, which its input does not accept`)
        : [],
    ),
    unresolvable: procedures
      .filter(({ access }) => access.kind === "permission" || access.kind === "permission-any")
      .filter((procedure) => covered(procedure).length === 0)
      .map(({ path }) => `${path} declares a permission its input carries no scope id for`),
    opaque: procedures.filter(({ opaqueInput }) => opaqueInput).map(({ path }) => path),
  };
}

interface SweepApi {
  answer(): Promise<null>;
}

const SweepApi = moduleApi<SweepApi>()("annotation");

const answer = async (): Promise<void> => {};

describe("the authz declaration sweep over typed tRPC declarations", () => {
  describe("given procedures each checked, claimed, unchecked or stale", () => {
    const contract = defineTrpcContract("scoped")
      .mutation("orgChecked")
      .withInput(z.object({ organizationId: z.string(), projectId: z.string() }))
      .mutation("claimed")
      .withInput(z.object({ organizationId: z.string(), projectId: z.string() }))
      .mutation("unclaimed")
      .withInput(z.object({ projectId: z.string() }))
      .mutation("staleClaim")
      .withInput(z.object({ projectId: z.string() }))
      .build();

    const router = defineTrpcRouter(SweepApi, contract)
      .procedure("orgChecked")
      .withPermission("governance:manage")
      .handle(answer)
      .procedure("claimed")
      .serviceAuthorized({
        reason: "the resolver filters by membership",
        permissions: [],
        enforces: { organizationId: "membership filter", projectId: "project lineage" },
      })
      .handle(answer)
      .procedure("unclaimed")
      .noPermission({ reason: "reads nothing tenant-owned" })
      .handle(answer)
      .procedure("staleClaim")
      .serviceAuthorized({
        reason: "the resolver checks the team",
        permissions: [],
        enforces: { projectId: "project lineage", teamId: "renamed away" },
      })
      .handle(answer)
      .build();

    const result = sweep(collectProcedures([router as never]));

    /** @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("refuses exactly the id no declared check or claim covers, with no allowlist", () => {
      expect(result.unchecked).toEqual(["scoped.unclaimed accepts projectId unchecked"]);
    });

    /** @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("refuses a claim about a field the input does not accept", () => {
      expect(result.staleClaims).toEqual([
        "scoped.staleClaim claims to enforce teamId, which its input does not accept",
      ]);
    });

    /** @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("covers the narrower ids an organization-tier check anchors to that organization", () => {
      expect(result.unchecked.filter((line) => line.startsWith("scoped.orgChecked"))).toEqual([]);
    });
  });

  describe("given an organization-tier check on an input that also accepts an optional project id", () => {
    const contract = defineTrpcContract("audit")
      .mutation("list")
      .withInput(z.object({ organizationId: z.string(), projectId: z.string().optional() }))
      .build();
    const router = defineTrpcRouter(SweepApi, contract)
      .procedure("list")
      .withPermission("auditLog:view")
      .handle(answer)
      .build();

    /** @scenario "An optional narrower scope id cannot shadow a required wider tier" */
    it("reports the required organization id as unchecked", () => {
      expect(sweep(collectProcedures([router as never])).unchecked).toEqual([
        "audit.list accepts organizationId unchecked",
      ]);
    });

    /** @scenario "An optional narrower scope id cannot shadow a required wider tier" */
    it("keeps the organization id covered when no narrower id is accepted", () => {
      expect(
        coveredScopeFields({
          access: { kind: "permission", permission: "auditLog:view" },
          required: ["organizationId"],
          accepted: ["organizationId"],
        }),
      ).toEqual(["organizationId"]);
    });
  });

  describe("given a scope id that is nullable rather than optional", () => {
    const contract = defineTrpcContract("nullable")
      .mutation("read")
      .withInput(z.object({ projectId: z.string().nullable() }))
      .build();
    const router = defineTrpcRouter(SweepApi, contract)
      .procedure("read")
      .noPermission({ reason: "reads nothing tenant-owned" })
      .handle(answer)
      .build();

    /** @scenario "A nullable scope id is required, not skipped" */
    it("counts the nullable id as one that must be covered", () => {
      expect(sweep(collectProcedures([router as never])).unchecked).toEqual([
        "nullable.read accepts projectId unchecked",
      ]);
    });

    /** @scenario "A nullable scope id is required, not skipped" */
    it("treats a nullable or defaulted field as required and an optional one as absentable", () => {
      expect(scopeFieldsOf(z.object({ projectId: z.string().nullable() }))?.required).toEqual([
        "projectId",
      ]);
      expect(scopeFieldsOf(z.object({ projectId: z.string().default("") }))?.required).toEqual([
        "projectId",
      ]);
      expect(scopeFieldsOf(z.object({ projectId: z.string().optional() }))).toEqual({
        required: [],
        accepted: ["projectId"],
      });
    });
  });

  describe("given a procedure whose input schema the sweep cannot read", () => {
    const contract = defineTrpcContract("opaque")
      .mutation("upload")
      .withInput(z.custom<{ projectId: string }>(() => true))
      .build();
    const router = defineTrpcRouter(SweepApi, contract)
      .procedure("upload")
      .withPermission("datasets:create")
      .handle(answer)
      .build();

    /** @scenario "A procedure whose input cannot be inspected fails the sweep" */
    it("reports the procedure rather than skipping it", () => {
      const result = sweep(collectProcedures([router as never]));

      expect(result.opaque).toEqual(["opaque.upload"]);
      expect(result.unresolvable).toEqual([
        "opaque.upload declares a permission its input carries no scope id for",
      ]);
    });
  });

  describe("given a procedure whose input intersects two parsers", () => {
    const contract = defineTrpcContract("joined")
      .mutation("readable")
      .withInput(z.intersection(z.object({ projectId: z.string() }), z.object({ id: z.string() })))
      .mutation("halfOpaque")
      .withInput(
        z.intersection(
          z.object({ projectId: z.string() }),
          z.custom<{ id: string }>(() => true),
        ),
      )
      .mutation("unchecked")
      .withInput(z.intersection(z.object({ id: z.string() }), z.object({ teamId: z.string() })))
      .build();
    const router = defineTrpcRouter(SweepApi, contract)
      .procedure("readable")
      .withPermission("traces:view")
      .handle(answer)
      .procedure("halfOpaque")
      .withPermission("traces:view")
      .handle(answer)
      .procedure("unchecked")
      .noPermission({ reason: "reads nothing tenant-owned" })
      .handle(answer)
      .build();

    const result = sweep(collectProcedures([router as never]));

    /** @scenario "An input composed as an intersection is inspected, not skipped" */
    it("checks a scope id either parser carries at its own tier", () => {
      expect(result.unchecked).toEqual(["joined.unchecked accepts teamId unchecked"]);
      expect(result.unresolvable).not.toContain(
        "joined.readable declares a permission its input carries no scope id for",
      );
    });

    /** @scenario "An input composed as an intersection is inspected, not skipped" */
    it("still reports an intersection with a member the sweep cannot read", () => {
      expect(result.opaque).toEqual(["joined.halfOpaque"]);
    });
  });
});
