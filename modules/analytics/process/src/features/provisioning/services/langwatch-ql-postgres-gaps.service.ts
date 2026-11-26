/**
 * What the reconvergence check repairs in PostgreSQL: the shared approved views, and the
 * scoped-reader group's grants and scoped copies (ADR-159).
 * @see specs/lwql/api.feature
 */
import type {
  LwqlPostgresViewFound,
  LwqlScopedViewState,
} from "../../../repositories/langwatch-ql-postgres.repository.ts";
import { LWQL_PROJECT_KEYS_VIEW } from "../rules/lwql-scoped-view.rules.ts";
import { LangWatchQLPostgresViewsService } from "./langwatch-ql-postgres-views.service.ts";

const postgresViews = LangWatchQLPostgresViewsService.create();

/**
 * What the check repairs in PostgreSQL. `shared`: an approved view absent, or not granted to the
 * shared reader. The rest exist only with the scoped-reader group: its grant on a shared view, its
 * scoped schema absent, or one copy absent, unscoped (fails the scoped-view check) or ungranted.
 */
export type LwqlPostgresGap =
  | { readonly kind: "shared"; readonly view: string; readonly absent: boolean }
  | { readonly kind: "group-on-shared"; readonly view: string }
  | { readonly kind: "scoped-schema-absent" }
  | {
      readonly kind: "scoped";
      readonly view: string;
      readonly repair: "absent" | "unscoped" | "ungranted";
    };

/** A gap on a shared approved view, which the shared reader reads. */
type LwqlSharedPostgresGap = Extract<LwqlPostgresGap, { kind: "shared" }>;

/** How a copy falls short, checked in order; none when the group can read it. */
function copyRepair({ copy }: { copy: LwqlScopedViewState["copies"][number] }) {
  if (!copy.exists) return "absent";
  if (!copy.passesGuard) return "unscoped";
  if (!copy.granted) return "ungranted";
  return undefined;
}

/** The scoped-reader group's gaps; none without the group or in another installation's schema. */
function scopedGaps({ scoped }: { scoped: LwqlScopedViewState }): LwqlPostgresGap[] {
  if (!scoped.groupExists) return [];
  const onShared = scoped.groupOnShared.map((view): LwqlPostgresGap => ({
    kind: "group-on-shared",
    view,
  }));
  if (scoped.scopedSchema === "absent") {
    return [...onShared, { kind: "scoped-schema-absent" }];
  }
  if (scoped.scopedSchema === "foreign") return onShared;
  return [
    ...onShared,
    ...scoped.copies.flatMap((copy): LwqlPostgresGap[] => {
      const repair = copyRepair({ copy });
      return repair === undefined ? [] : [{ kind: "scoped", view: copy.view, repair }];
    }),
  ];
}

/** Finds the PostgreSQL gaps and picks out what each repair step needs from them. */
export class LangWatchQLPostgresGapsService {
  static create(): LangWatchQLPostgresGapsService {
    return new LangWatchQLPostgresGapsService();
  }

  private constructor() {}

  /**
   * Each approved view absent, or present but not selectable by the reader; then, only where the
   * scoped-reader group exists, its grant on a shared view and each copy it cannot read.
   */
  findGaps({
    found,
    scoped,
  }: {
    found: readonly LwqlPostgresViewFound[];
    scoped: LwqlScopedViewState;
  }): LwqlPostgresGap[] {
    const byName = new Map(found.map((view) => [view.view, view]));
    const shared = postgresViews
      .approvedViewNames()
      .filter((view) => byName.get(view)?.granted !== true)
      .map((view): LwqlPostgresGap => ({ kind: "shared", view, absent: !byName.has(view) }));
    return [...shared, ...scopedGaps({ scoped })];
  }

  /** The gaps on shared approved views alone. */
  sharedGaps({ gaps }: { gaps: readonly LwqlPostgresGap[] }): LwqlSharedPostgresGap[] {
    return gaps.filter((gap): gap is LwqlSharedPostgresGap => gap.kind === "shared");
  }

  /** Whether the project-keys copy is a gap: the schema was absent, or that copy falls short. */
  needsProjectKeys({ gaps }: { gaps: readonly LwqlPostgresGap[] }): boolean {
    return gaps.some(
      (gap) =>
        gap.kind === "scoped-schema-absent" ||
        (gap.kind === "scoped" && gap.view === LWQL_PROJECT_KEYS_VIEW),
    );
  }

  /**
   * The copies a check rewrites: every one once the scoped schema was found absent, else each
   * absent or unscoped copy. An ungranted copy needs only its grant.
   */
  scopedCopiesToRebuild({ gaps }: { gaps: readonly LwqlPostgresGap[] }): string[] {
    if (gaps.some((gap) => gap.kind === "scoped-schema-absent")) {
      return postgresViews.approvedViewNames();
    }
    return gaps.flatMap((gap) =>
      gap.kind === "scoped" && gap.repair !== "ungranted" ? [gap.view] : [],
    );
  }
}
