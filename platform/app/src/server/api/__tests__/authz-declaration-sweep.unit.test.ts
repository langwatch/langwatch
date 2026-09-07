/** @vitest-environment node */

/**
 * The fail-closed half of ADR-092 decision 25, in three parts.
 *
 * 1. Every tRPC procedure declares its access decision — `.permission()`,
 *    `.permissionAny()`, `.noPermission({ reason })`, `.authorizeInService()`,
 *    or a custom middleware tagged via `declareAuthzMiddleware`.
 * 2. Every scope id a procedure ACCEPTS is checked at its own tier, or
 *    explicitly allowed with a written reason. An endpoint that takes a
 *    projectId and only checks the organization is the hole this closes: the
 *    caller supplies the projectId, so nothing else proves it is theirs.
 * 3. Every declaration can actually resolve a scope from the input it has.
 *
 * The type system refuses most of this at the call site — `.permission()`
 * will not compile without a required field at a tier the permission is
 * grantable at, and `.noPermission()` demands a reason per scope field. This
 * sweep is the channel the types cannot cover: custom middlewares, inputs
 * widened through `as`, and any procedure whose chain was assembled by hand.
 * `enforcePermissionCheck` catches an undeclared procedure at runtime on its
 * first call; this moves the discovery to CI, before any call exists.
 */
import {
  type AuthzDeclaration,
  type AuthzPermission,
  authzDeclarationOf,
  isPlatformTierPermission,
  permissionGrantTiers,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { authorizeInResolver } from "../rbac";
import { appRouter } from "../root";

const SCOPE_FIELDS = Object.values(SCOPE_TIER_FIELDS) as ScopeTierField[];

/**
 * Procedures whose declared permission resolves no scope from their input,
 * and procedures whose input schema cannot be read at all. Same rule as
 * above: shrink only.
 */
const UNRESOLVABLE_SCOPES: readonly string[] = [
  "dataset.upsert declares a permission its input carries no scope id for",
  "datasetRecord.create declares a permission its input carries no scope id for",
];

const OPAQUE_INPUTS: readonly string[] = [
  "dataset.upsert",
  "datasetRecord.create",
];

type Procedure = {
  path: string;
  declaration: AuthzDeclaration | null;
  /** Scope fields that always reach the handler carrying an id — every field
   *  except a genuinely omittable one (`ZodOptional`, or a union that admits
   *  `undefined`). A nullable or defaulted field counts as required: the
   *  first must be sent, the second always arrives with a value, so both are
   *  ids the handler acts on and both must be covered. */
  requiredScopeFields: ScopeTierField[];
  /** Every scope field the input can carry, optional ones included. This is
   *  the set the runtime's `declaredScopeId` actually resolves a tier from,
   *  so a `.permission()` check is judged against it: an optional narrower id
   *  can shadow a required wider one and leave the wider tier unchecked. */
  acceptedScopeFields: ScopeTierField[];
  /** True when the input could not be introspected at all — reported rather
   *  than skipped, so an unreadable schema can never pass by silence. */
  opaqueInput: boolean;
};

/** Strip the wrappers a parser may be behind before its shape is readable. */
function unwrap(schema: unknown): any {
  let current: any = schema;
  for (let depth = 0; depth < 10 && current?._def; depth += 1) {
    const inner =
      current._def.schema ?? current._def.innerType ?? current._def.in;
    if (!inner) break;
    current = inner;
  }
  return current;
}

/**
 * Whether a field can reach the handler with no value at all.
 *
 * Only `ZodOptional` (and a union that admits `undefined`) is absentable. A
 * `ZodDefault` is omittable on the wire but ALWAYS arrives carrying its
 * default, and a `ZodNullable` MUST be sent — so both reach the handler as an
 * id the runtime resolves a tier from, and neither may be skipped. Treating
 * them as absent was the hole that let a `z.string().nullable()` scope id
 * ship unchecked while the sweep stayed green.
 */
function isAbsentable(field: unknown): boolean {
  const name = (field as any)?._def?.typeName;
  if (name === "ZodDefault" || name === "ZodNullable") return false;
  if (name === "ZodOptional") return true;
  return (
    typeof (field as any)?.isOptional === "function" &&
    (field as any).isOptional()
  );
}

type ScopeFieldSets = {
  required: ScopeTierField[];
  accepted: ScopeTierField[];
};

/**
 * The scope fields one parser requires and the fields it can carry at all.
 * Null when the schema cannot be read, which the caller reports rather than
 * treating as "no scope fields".
 *
 * A union requires a field only when every member does — a member that omits
 * it can be sent without one — but accepts a field that ANY member carries,
 * since the runtime resolves a tier from whichever arrived.
 */
function scopeFieldsOf(parser: unknown): ScopeFieldSets | null {
  const schema = unwrap(parser);
  const typeName = schema?._def?.typeName;

  if (typeName === "ZodUnion" || typeName === "ZodDiscriminatedUnion") {
    const options: unknown[] =
      schema._def.options instanceof Map
        ? [...schema._def.options.values()]
        : (schema._def.options ?? []);
    const perMember = options.map(scopeFieldsOf);
    if (perMember.some((member) => member === null)) return null;
    const members = perMember as ScopeFieldSets[];
    const [first, ...rest] = members;
    if (!first) return { required: [], accepted: [] };
    return {
      required: first.required.filter((field) =>
        rest.every((member) => member.required.includes(field)),
      ),
      accepted: [...new Set(members.flatMap((member) => member.accepted))],
    };
  }

  const shape =
    typeof schema?.shape === "function" ? schema.shape() : schema?.shape;
  if (!shape || typeof shape !== "object") return null;

  return {
    required: SCOPE_FIELDS.filter(
      (field) => field in shape && !isAbsentable(shape[field]),
    ),
    accepted: SCOPE_FIELDS.filter((field) => field in shape),
  };
}

/** The scope fields a declaration actually causes to be checked. */
function coveredScopeFields({
  declaration,
  required,
  accepted,
}: {
  declaration: AuthzDeclaration;
  /** Fields that always arrive — the set a custom middleware is trusted to
   *  check, since its enforcement is opaque to the sweep. */
  required: ScopeTierField[];
  /** Every field the input can carry — the set a declared `.permission()`
   *  resolves its tier from at runtime, so the sweep judges those kinds
   *  against it to see the tier the runtime will actually pick. */
  accepted: ScopeTierField[];
}): ScopeTierField[] {
  const forPermission = (
    permission: AuthzPermission,
    present: ScopeTierField[],
    via?: ScopeTierField,
  ): ScopeTierField[] => {
    // `via` names the id the check resolves its scope FROM, so that id is
    // validated even though the permission is granted at a wider tier.
    if (via) return [via];
    // An operator gate sits above the scope hierarchy rather than inside it:
    // the caller is an operator or they are not, and no per-project answer
    // would add anything. So a platform-tier declaration covers every id the
    // input carries.
    if (isPlatformTierPermission(permission)) return present;
    // The runtime reads the narrowest grantable tier whose id is present —
    // exactly what `declaredScopeId` does.
    const tier = permissionGrantTiers(permission).find((candidate) =>
      present.includes(SCOPE_TIER_FIELDS[candidate]),
    );
    if (!tier) return [];
    // When the checked tier is the organization, every narrower id the input
    // carries is anchored to that SAME organization at runtime: the scope
    // lineage guard (scope-lineage-guard.ts) runs ahead of every check and
    // refuses any request whose scope ids resolve to different organizations
    // (or to none). An org-wide grant authorizes the org's teams and
    // projects, so those ids are covered — by the guard, not by trust.
    if (tier === "organization") return present;
    return [SCOPE_TIER_FIELDS[tier]];
  };

  switch (declaration.kind) {
    // The declared kinds resolve their tier at runtime through
    // `declaredScopeId`, narrowest present id first, over the whole parsed
    // input — so they are judged against `accepted`, the set that includes the
    // optional narrower ids that can shadow a required wider one.
    case "permission":
      return forPermission(declaration.permission, accepted, declaration.via);
    case "permission-any":
      return declaration.permissions.flatMap((permission) =>
        forPermission(permission, accepted),
      );
    // A custom or service-authorized middleware runs its OWN enforcement,
    // opaque to the sweep, so its declared permissions are trusted against the
    // fields that always arrive rather than resolved positionally. Fields the
    // declaration explicitly claims its resolver enforces (`enforces`) are
    // covered the same way `.noPermission()`'s `allow` covers its fields: a
    // named, reviewable claim rather than silence.
    case "service-authorized":
    case "custom":
      return [
        ...declaration.permissions.flatMap((permission) =>
          forPermission(permission, required),
        ),
        ...(Object.keys(declaration.enforces ?? {}) as ScopeTierField[]),
      ];
    case "no-permission":
      return Object.keys(declaration.allow ?? {}) as ScopeTierField[];
  }
}

function collectProcedures(): Procedure[] {
  const procedures = (
    appRouter as unknown as { _def: { procedures: Record<string, unknown> } }
  )._def.procedures;

  return Object.entries(procedures).map(([path, procedure]) => {
    const def = (procedure as { _def?: Record<string, any> })._def ?? {};
    const declaration =
      (def.middlewares ?? [])
        .map((middleware: unknown) => authzDeclarationOf(middleware))
        .find((found: AuthzDeclaration | null) => found !== null) ?? null;

    const inputs: unknown[] = def.inputs ?? [];
    const perInput = inputs.map(scopeFieldsOf);
    const readable = perInput.filter(Boolean) as ScopeFieldSets[];
    return {
      path,
      declaration,
      opaqueInput: perInput.some((fields) => fields === null),
      // tRPC intersects chained `.input()` calls, so a field required by any
      // of them is required overall, and a field any of them accepts is
      // accepted overall.
      requiredScopeFields: [
        ...new Set(readable.flatMap((fields) => fields.required)),
      ],
      acceptedScopeFields: [
        ...new Set(readable.flatMap((fields) => fields.accepted)),
      ],
    };
  });
}

describe("tRPC authz declaration sweep", () => {
  const procedures = collectProcedures();

  describe("given the real router's procedure map", () => {
    /** @scenario "Every tRPC procedure declares its access decision or an explicit reason not to" */
    it("finds a declaration on every procedure", () => {
      const undeclared = procedures
        .filter((procedure) => procedure.declaration === null)
        .map((procedure) => procedure.path)
        .sort();

      expect(undeclared).toEqual([]);
    });

    /** @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("checks every required scope id at its own tier", () => {
      const unchecked = procedures
        .filter((procedure) => procedure.declaration !== null)
        .flatMap((procedure) => {
          const covered = coveredScopeFields({
            declaration: procedure.declaration!,
            required: procedure.requiredScopeFields,
            accepted: procedure.acceptedScopeFields,
          });
          return procedure.requiredScopeFields
            .filter((field) => !covered.includes(field))
            .map((field) => `${procedure.path} accepts ${field} unchecked`);
        })
        .sort();

      // No allowlist. Every scope id is checked at its own tier, covered by
      // the organization-tier rule (the lineage guard anchors narrower ids),
      // or carries a per-field `enforces` claim naming what the resolver
      // does. A new endpoint accepting a caller-supplied id nothing proves
      // belongs to them fails here, and the fix is a real check or a
      // reviewable claim — never an exception list.
      expect(unchecked).toEqual([]);
    });

    /** A claim about a field the input does not carry is rot: the field was
     *  renamed or removed and the declaration kept asserting enforcement of
     *  nothing. Refusing it keeps `enforces` honest the same way the
     *  staleness rule keeps the gap list honest.
     *  @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("refuses an enforces claim about a scope field the input does not accept", () => {
      const stale = procedures
        .filter(
          (procedure) =>
            procedure.declaration?.kind === "custom" ||
            procedure.declaration?.kind === "service-authorized",
        )
        .flatMap((procedure) => {
          const declaration = procedure.declaration as Extract<
            AuthzDeclaration,
            { kind: "custom" | "service-authorized" }
          >;
          return (Object.keys(declaration.enforces ?? {}) as ScopeTierField[])
            .filter((field) => !procedure.acceptedScopeFields.includes(field))
            .map(
              (field) =>
                `${procedure.path} claims to enforce ${field}, which its input does not accept`,
            );
        })
        .sort();

      expect(stale).toEqual([]);
    });

    /** @scenario "A declaration that cannot resolve a scope from its input fails the sweep" */
    it("resolves a scope for every declared permission", () => {
      const unresolvable = procedures
        .filter(
          (procedure) =>
            procedure.declaration?.kind === "permission" ||
            procedure.declaration?.kind === "permission-any",
        )
        .filter((procedure) => {
          const covered = coveredScopeFields({
            declaration: procedure.declaration!,
            required: procedure.requiredScopeFields,
            accepted: procedure.acceptedScopeFields,
          });
          return covered.length === 0;
        })
        .map(
          (procedure) =>
            `${procedure.path} declares a permission its input carries no scope id for`,
        )
        .sort();

      expect(unresolvable).toEqual(UNRESOLVABLE_SCOPES);
    });

    /** @scenario "A procedure whose input cannot be inspected fails the sweep" */
    it("reads the input schema of every procedure that takes one", () => {
      const opaque = procedures
        .filter((procedure) => procedure.opaqueInput)
        .map((procedure) => procedure.path)
        .sort();

      expect(opaque).toEqual(OPAQUE_INPUTS);
    });
  });

  describe("given a declared check whose tier an optional narrower id shadows", () => {
    /** @scenario "An optional narrower scope id cannot shadow a required wider tier" */
    it("reports the required wider id as unchecked", () => {
      // The getAuditLogs class: an org-tier permission declared on an input
      // that requires organizationId but also accepts an optional projectId.
      // `declaredScopeId` resolves narrowest-present first, so a supplied
      // projectId moves the check to the project tier and the required
      // organizationId — the id the query is anchored on — goes unchecked.
      const covered = coveredScopeFields({
        declaration: { kind: "permission", permission: "auditLog:view" },
        required: ["organizationId"],
        accepted: ["organizationId", "projectId"],
      });

      expect(covered).toEqual(["projectId"]);
      expect(covered).not.toContain("organizationId");
    });

    it("keeps the wider id covered when no narrower id is accepted", () => {
      const covered = coveredScopeFields({
        declaration: { kind: "permission", permission: "auditLog:view" },
        required: ["organizationId"],
        accepted: ["organizationId"],
      });

      expect(covered).toEqual(["organizationId"]);
    });
  });

  describe("given a check resolved at the organization tier", () => {
    /** The lineage guard refuses any request whose scope ids resolve to more
     *  than one organization, so an org-tier check covers the narrower ids
     *  the input carries — the departments.assignTeam class.
     *  @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("covers the narrower ids the lineage guard anchors to that organization", () => {
      const covered = coveredScopeFields({
        declaration: { kind: "permission", permission: "governance:manage" },
        required: ["organizationId", "teamId"],
        accepted: ["organizationId", "teamId"],
      });

      expect(covered).toEqual(expect.arrayContaining(["teamId"]));
    });

    /** The rule must not leak below the organization: a check the runtime
     *  resolves at a narrower tier covers only the id it resolved from —
     *  same-organization (which the lineage guard does prove) is not
     *  same-team, so the sibling id stays uncovered and the sweep reports
     *  it. */
    it("does not extend a narrower-tier check the same way", () => {
      const covered = coveredScopeFields({
        declaration: { kind: "permission", permission: "team:manage" },
        required: ["teamId", "projectId"],
        accepted: ["teamId", "projectId"],
      });

      expect(covered).toHaveLength(1);
      expect(covered).not.toEqual(
        expect.arrayContaining(["teamId", "projectId"]),
      );
    });
  });

  describe("given a resolver-authorized declaration with enforces claims", () => {
    /** @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("covers exactly the claimed fields and nothing more", () => {
      const covered = coveredScopeFields({
        declaration: {
          kind: "service-authorized",
          reason: "membership filter in the resolver",
          permissions: [],
          enforces: { organizationId: "membership-set visibility filter" },
        },
        required: ["organizationId", "projectId"],
        accepted: ["organizationId", "projectId"],
      });

      expect(covered).toEqual(["organizationId"]);
    });

    /** The factory is the only way to build one, and it must carry the
     *  claims through to the declaration the sweep reads — a factory that
     *  dropped them would quietly re-create the rubber stamp this replaced.
     *  @scenario "Every scope id a procedure accepts is checked or explicitly allowed" */
    it("reads the claims off the middleware authorizeInResolver builds", () => {
      const middleware = authorizeInResolver({
        organizationId: "claimed for this sentinel",
      });

      const declaration = authzDeclarationOf(middleware);
      expect(declaration).toMatchObject({
        kind: "service-authorized",
        enforces: { organizationId: "claimed for this sentinel" },
      });
    });
  });

  describe("given a scope id that is nullable rather than optional", () => {
    /** @scenario "A nullable scope id is required, not skipped" */
    it("treats a ZodNullable field as required and a ZodOptional field as absentable", () => {
      const nullable = z.object({ projectId: z.string().nullable() });
      const optional = z.object({ projectId: z.string().optional() });
      const defaulted = z.object({ projectId: z.string().default("") });

      expect(scopeFieldsOf(nullable)?.required).toEqual(["projectId"]);
      expect(scopeFieldsOf(defaulted)?.required).toEqual(["projectId"]);
      expect(scopeFieldsOf(optional)?.required).toEqual([]);
      expect(scopeFieldsOf(optional)?.accepted).toEqual(["projectId"]);
    });
  });
});
