/**
 * ADR-092 decision 25, fail-closed half. Every scope id a procedure ACCEPTS is
 * checked at its own tier or explicitly claimed. An endpoint that takes a
 * projectId and only checks the organization is the hole this closes: the
 * caller supplies the projectId, so nothing else proves it is theirs.
 *
 * The declaration types refuse most of this at the call site; this sweep is the
 * channel the types cannot cover — custom middlewares, widened inputs, and any
 * chain assembled by hand.
 */
import {
  type AuthzDeclaration,
  type AuthzPermission,
  authzDeclarationOf,
  isPlatformTierPermission,
  permissionGrantTiers,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildAppTrpcFeatures } from "./support/app-trpc-features";

const SCOPE_FIELDS = Object.values(SCOPE_TIER_FIELDS) as ScopeTierField[];

type Procedure = {
  path: string;
  declaration: AuthzDeclaration | null;
  /** Scope fields that always reach the handler carrying an id — every field
   *  except a genuinely omittable one. A nullable or defaulted field counts as
   *  required: the first must be sent, the second always arrives with a value. */
  requiredScopeFields: ScopeTierField[];
  /** Every scope field the input can carry, optional ones included — the set
   *  the runtime resolves a tier from, so an optional narrower id can shadow a
   *  required wider one and leave the wider tier unchecked. */
  acceptedScopeFields: ScopeTierField[];
  /** True when the input could not be introspected at all — reported rather
   *  than skipped, so an unreadable schema can never pass by silence. */
  opaqueInput: boolean;
};

type ZodDef = { type?: string; innerType?: unknown; in?: unknown; schema?: unknown };

const defOf = (schema: unknown): ZodDef | undefined =>
  (schema as { _def?: ZodDef } | undefined)?._def;

/** Strip the wrappers a parser may be behind before its shape is readable. */
function unwrap(schema: unknown): unknown {
  let current = schema;
  for (let depth = 0; depth < 10; depth += 1) {
    const def = defOf(current);
    if (!def) break;
    const inner = def.schema ?? def.innerType ?? def.in;
    if (!inner) break;
    current = inner;
  }
  return current;
}

/**
 * Whether a field can reach the handler with no value at all.
 *
 * Only an optional field is absentable. A defaulted field is omittable on the
 * wire but ALWAYS arrives carrying its default, and a nullable field MUST be
 * sent — so both reach the handler as an id the runtime resolves a tier from.
 */
function isAbsentable(field: unknown): boolean {
  const type = defOf(field)?.type;
  if (type === "default" || type === "nullable") return false;
  if (type === "optional") return true;
  const isOptional = (field as { isOptional?: () => boolean } | undefined)?.isOptional;
  return typeof isOptional === "function" && isOptional.call(field);
}

type ScopeFieldSets = { required: ScopeTierField[]; accepted: ScopeTierField[] };

/**
 * The scope fields one parser requires and the fields it can carry at all.
 * Null when the schema cannot be read, which the caller reports rather than
 * treating as "no scope fields".
 */
function scopeFieldsOf(parser: unknown): ScopeFieldSets | null {
  const schema = unwrap(parser);
  const def = defOf(schema);

  // A union requires a field only when every member does, and accepts a field
  // any member carries, since the runtime resolves a tier from whichever came.
  if (def?.type === "union") {
    const options = (schema as { _def: { options?: unknown[] } })._def.options ?? [];
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

  // A transport handed its base parser as a port composes with an intersection
  // rather than a merged object, so reading only the outer parser would leave
  // both halves' scope ids invisible. Either half requiring a field requires
  // it; an unreadable half makes the whole unreadable.
  if (def?.type === "intersection") {
    const { left, right } = (schema as { _def: { left: unknown; right: unknown } })._def;
    const halves = [scopeFieldsOf(left), scopeFieldsOf(right)];
    if (halves.some((half) => half === null)) return null;
    const [leftFields, rightFields] = halves as ScopeFieldSets[];
    return {
      required: [...new Set([...leftFields!.required, ...rightFields!.required])],
      accepted: [...new Set([...leftFields!.accepted, ...rightFields!.accepted])],
    };
  }

  const shape = (schema as { shape?: Record<string, unknown> } | undefined)?.shape;
  if (!shape || typeof shape !== "object") return null;

  return {
    required: SCOPE_FIELDS.filter((field) => field in shape && !isAbsentable(shape[field])),
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
  required: ScopeTierField[];
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
    // An operator gate sits above the scope hierarchy: the caller is an
    // operator or they are not, so it covers every id the input carries.
    if (isPlatformTierPermission(permission)) return present;
    const tier = permissionGrantTiers(permission).find((candidate) =>
      present.includes(SCOPE_TIER_FIELDS[candidate]),
    );
    if (!tier) return [];
    // The scope lineage guard refuses any request whose ids resolve to
    // different organizations, so an organization-tier check covers the
    // narrower ids the input carries — by the guard, not by trust.
    if (tier === "organization") return present;
    return [SCOPE_TIER_FIELDS[tier]];
  };

  switch (declaration.kind) {
    case "permission":
      return forPermission(declaration.permission, accepted, declaration.via);
    case "permission-any":
      return declaration.permissions.flatMap((permission) => forPermission(permission, accepted));
    // A custom or service-authorized middleware runs its OWN enforcement,
    // opaque to the sweep, so its permissions are trusted against the fields
    // that always arrive, and the fields it claims to enforce are covered the
    // way `.noPermission()`'s `allow` covers its own.
    case "service-authorized":
    case "custom":
      return [
        ...declaration.permissions.flatMap((permission) => forPermission(permission, required)),
        ...(Object.keys(declaration.enforces ?? {}) as ScopeTierField[]),
      ];
    case "no-permission":
      return Object.keys(declaration.allow ?? {}) as ScopeTierField[];
  }
}

function collectProcedures(): Procedure[] {
  const features = buildAppTrpcFeatures() as Record<string, unknown>;

  return Object.entries(features).flatMap(([namespace, router]) => {
    const procedures = (router as { _def?: { procedures?: Record<string, unknown> } })._def
      ?.procedures;
    if (!procedures) return [];

    return Object.entries(procedures).map(([name, procedure]) => {
      const def = (procedure as { _def?: Record<string, unknown> })._def ?? {};
      const declaration =
        ((def.middlewares as unknown[]) ?? [])
          .map((middleware) => authzDeclarationOf(middleware))
          .find((found) => found !== null) ?? null;

      const inputs = (def.inputs as unknown[]) ?? [];
      const perInput = inputs.map(scopeFieldsOf);
      const readable = perInput.filter((fields): fields is ScopeFieldSets => fields !== null);
      return {
        path: `${namespace}.${name}`,
        declaration,
        opaqueInput: perInput.some((fields) => fields === null),
        // tRPC intersects chained `.input()` calls, so a field required by any
        // of them is required overall, and one any accepts is accepted overall.
        requiredScopeFields: [...new Set(readable.flatMap((fields) => fields.required))],
        acceptedScopeFields: [...new Set(readable.flatMap((fields) => fields.accepted))],
      };
    });
  });
}

describe("the app tRPC authz declaration sweep", () => {
  const procedures = collectProcedures();

  describe("given the process's own procedure map", () => {
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

      expect(unchecked).toEqual([]);
    });

    /** A procedure with no declaration is not a procedure the sweep can
     *  reason about at all: nothing names the permission it needs, so every
     *  later check reads it as vacuously covered. It is the hole the sweep
     *  used to filter away.
     *  @scenario "A tRPC procedure with no access declaration fails the sweep" */
    it("refuses a procedure with no access declaration", () => {
      const undeclared = procedures
        .filter((procedure) => procedure.declaration === null)
        .map((procedure) => `${procedure.path} declares no access`)
        .sort();

      expect(undeclared).toEqual([]);
    });

    /** A claim about a field the input does not carry is rot: the field was
     *  renamed or removed and the declaration kept asserting enforcement of
     *  nothing.
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

    /** The trace grid takes its list parser as a PORT, which this record's
     *  refusing trace feature answers with a stand-in rather than the real
     *  parser, so those six read as unreadable here. Named rather than
     *  skipped: any seventh unreadable input is a procedure whose scope ids
     *  nothing proved, and it fails this list.
     *  @scenario "A procedure whose input cannot be inspected fails the sweep" */
    it("reads the input schema of every procedure that takes one", () => {
      const opaque = procedures
        .filter((procedure) => procedure.opaqueInput)
        .map((procedure) => procedure.path)
        .sort();

      expect(opaque).toEqual([
        "traces.getAllForDownload",
        "traces.getAllForProject",
        "traces.getCustomersAndLabels",
        "traces.getSampleTraces",
        "traces.getSampleTracesDataset",
        "traces.getTopicCounts",
      ]);
    });
  });

  describe("given a declared check whose tier an optional narrower id shadows", () => {
    /** @scenario "An optional narrower scope id cannot shadow a required wider tier" */
    it("reports the required wider id as unchecked", () => {
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

  describe("given a scope id that is nullable rather than optional", () => {
    /** @scenario "A nullable scope id is required, not skipped" */
    it("treats a nullable field as required and an optional field as absentable", () => {
      const nullable = z.object({ projectId: z.string().nullable() });
      const optional = z.object({ projectId: z.string().optional() });
      const defaulted = z.object({ projectId: z.string().default("") });

      expect(scopeFieldsOf(nullable)?.required).toEqual(["projectId"]);
      expect(scopeFieldsOf(defaulted)?.required).toEqual(["projectId"]);
      expect(scopeFieldsOf(optional)?.required).toEqual([]);
      expect(scopeFieldsOf(optional)?.accepted).toEqual(["projectId"]);
    });
  });

  describe("given an input composed as an intersection of two parsers", () => {
    /** @scenario "An input composed as an intersection is inspected, not skipped" */
    it("reads a scope id either half carries", () => {
      const intersected = z.intersection(
        z.object({ organizationId: z.string() }),
        z.object({ projectId: z.string().optional() }),
      );

      expect(scopeFieldsOf(intersected)?.required).toEqual(["organizationId"]);
      expect(scopeFieldsOf(intersected)?.accepted).toEqual(
        expect.arrayContaining(["organizationId", "projectId"]),
      );
    });

    /** @scenario "An input composed as an intersection is inspected, not skipped" */
    it("reports an intersection with a half it cannot read", () => {
      const unreadable = z.intersection(z.object({ projectId: z.string() }), z.string());

      expect(scopeFieldsOf(unreadable)).toBeNull();
    });
  });
});
