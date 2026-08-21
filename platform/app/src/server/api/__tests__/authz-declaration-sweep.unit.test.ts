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
  type AuthzPermission,
  isPlatformTierPermission,
  permissionGrantTiers,
  SCOPE_TIER_FIELDS,
  type ScopeTierField,
} from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import {
  type AuthzDeclaration,
  authzDeclarationOf,
} from "~/server/app-layer/authz/declared-middleware";
import { appRouter } from "../root";

const SCOPE_FIELDS = Object.values(SCOPE_TIER_FIELDS) as ScopeTierField[];

/**
 * The scope ids that reach a handler today without a check the sweep can
 * verify, and the reason each is here rather than fixed.
 *
 * This list may only SHRINK. A new entry means a new endpoint accepting a
 * caller-supplied id nothing proves belongs to them; the sweep fails on it,
 * and adding it here is a decision to be argued in review, not a formality.
 * Entries that stop being true also fail the suite (see the staleness check),
 * so fixing one forces its removal.
 *
 * Almost all of these share one cause: a `custom` or `service-authorized`
 * declaration that names NO permission, so the sweep has nothing to check
 * against. `virtualKeys.*` is the pattern — `authorizeInResolver` says "the
 * resolver enforces it" and the resolver does (a membership filter), but the
 * declaration carries no machine-readable claim about which id that covers.
 * The fix is to make those declarations name the scope fields their resolver
 * enforces, the way `.noPermission()` already names an `allow` reason per
 * field; then this list empties out on its own.
 */
const UNCHECKED_SCOPE_IDS: readonly string[] = [
  "dataPrivacy.removeForScope accepts projectId unchecked",
  "dataPrivacy.setForScope accepts projectId unchecked",
  "dataRetention.previewScopeRemoval accepts projectId unchecked",
  "dataRetention.removeForScope accepts projectId unchecked",
  "dataRetention.setForScope accepts projectId unchecked",
  "departments.assignProject accepts projectId unchecked",
  "departments.assignTeam accepts teamId unchecked",
  "gatewayUsage.summary accepts organizationId unchecked",
  "gatewayUsage.summaryForVirtualKey accepts organizationId unchecked",
  "llmModelCost.createOrUpdate accepts projectId unchecked",
  "llmModelCost.delete accepts projectId unchecked",
  "personalVirtualKeys.list accepts organizationId unchecked",
  "role.assignToUser accepts teamId unchecked",
  "virtualKeys.applicableBudgets accepts organizationId unchecked",
  "virtualKeys.create accepts organizationId unchecked",
  "virtualKeys.disable accepts organizationId unchecked",
  "virtualKeys.enable accepts organizationId unchecked",
  "virtualKeys.get accepts organizationId unchecked",
  "virtualKeys.list accepts organizationId unchecked",
  "virtualKeys.revoke accepts organizationId unchecked",
  "virtualKeys.rotate accepts organizationId unchecked",
  "virtualKeys.spendThisMonth accepts organizationId unchecked",
  "virtualKeys.update accepts organizationId unchecked",
];

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
  /** Scope fields the input requires. Optional ones are not swept: the
   *  runtime only reads a tier whose id is actually present, and an absent
   *  optional field addresses nothing. */
  requiredScopeFields: ScopeTierField[];
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

function isOptional(field: unknown): boolean {
  const name = (field as any)?._def?.typeName;
  return (
    name === "ZodOptional" ||
    name === "ZodDefault" ||
    name === "ZodNullable" ||
    (typeof (field as any)?.isOptional === "function" &&
      (field as any).isOptional())
  );
}

/**
 * The scope fields one parser REQUIRES. Null when the schema cannot be read,
 * which the caller reports rather than treating as "no scope fields".
 *
 * A union requires a field only when every member does — a member that omits
 * it can be sent without one, so the sweep must not assume it is there.
 */
function requiredScopeFieldsOf(parser: unknown): ScopeTierField[] | null {
  const schema = unwrap(parser);
  const typeName = schema?._def?.typeName;

  if (typeName === "ZodUnion" || typeName === "ZodDiscriminatedUnion") {
    const options: unknown[] =
      schema._def.options instanceof Map
        ? [...schema._def.options.values()]
        : (schema._def.options ?? []);
    const perMember = options.map(requiredScopeFieldsOf);
    if (perMember.some((member) => member === null)) return null;
    const [first, ...rest] = perMember as ScopeTierField[][];
    if (!first) return [];
    return first.filter((field) =>
      rest.every((member) => member.includes(field)),
    );
  }

  const shape =
    typeof schema?.shape === "function" ? schema.shape() : schema?.shape;
  if (!shape || typeof shape !== "object") return null;

  return SCOPE_FIELDS.filter(
    (field) => field in shape && !isOptional(shape[field]),
  );
}

/** The scope fields a declaration actually causes to be checked. */
function coveredScopeFields({
  declaration,
  present,
}: {
  declaration: AuthzDeclaration;
  present: ScopeTierField[];
}): ScopeTierField[] {
  const forPermission = (
    permission: AuthzPermission,
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
    return tier ? [SCOPE_TIER_FIELDS[tier]] : [];
  };

  switch (declaration.kind) {
    case "permission":
      return forPermission(declaration.permission, declaration.via);
    case "permission-any":
    case "service-authorized":
    case "custom":
      return declaration.permissions.flatMap((permission) =>
        forPermission(permission),
      );
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
    const perInput = inputs.map(requiredScopeFieldsOf);
    return {
      path,
      declaration,
      opaqueInput: perInput.some((fields) => fields === null),
      // tRPC intersects chained `.input()` calls, so a field required by any
      // of them is required overall.
      requiredScopeFields: [
        ...new Set((perInput.filter(Boolean) as ScopeTierField[][]).flat()),
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
            present: procedure.requiredScopeFields,
          });
          return procedure.requiredScopeFields
            .filter((field) => !covered.includes(field))
            .map((field) => `${procedure.path} accepts ${field} unchecked`);
        })
        .sort();

      expect(unchecked).toEqual(UNCHECKED_SCOPE_IDS);
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
            present: procedure.requiredScopeFields,
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
});
