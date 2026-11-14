import type { LangWatchQLProtections } from "@langwatch/analytics-contract";

import type { RejectedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";
import {
  fullGrantProtections,
  hiddenViewTables,
  isCallerAccessRejection,
  isCallerParameterRefusal,
} from "../rules/lwql-caller-access-refusal.rules.ts";
import type { LwqlCatalogue } from "../rules/lwql-catalogue.rules.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();

/**
 * Remembers which thrown refusals were the caller's own access, so the failure report can skip
 * them. The mark lives here, off the error, because `rules/` holds no state.
 * @see specs/lwql/query-origin.feature
 */
export class LangWatchQLAccessRefusalService {
  /** Held off the error, so the member's response cannot carry the verdict. */
  readonly #marked = new WeakSet<object>();
  /** A full grant depends on the catalogue alone, so each catalogue derives it once. */
  readonly #fullGrants = new WeakMap<LwqlCatalogue, LangWatchQLProtections>();

  static create(): LangWatchQLAccessRefusalService {
    return new LangWatchQLAccessRefusalService();
  }

  private constructor() {}

  /**
   * Marks the error about to be thrown when its rejection is the caller's access. A hidden view
   * is one this caller cannot see but a full grant would: a view no grant shows is nobody's access.
   */
  markIfCallerAccess({
    error,
    rejection,
    database,
    protections,
    views,
    catalog,
  }: {
    error: object;
    rejection: RejectedLangWatchQL;
    database: string;
    protections: LangWatchQLProtections;
    views: readonly LangWatchQLViewDefinition[];
    catalog: LwqlCatalogue;
  }): void {
    const hiddenTables =
      (rejection.refusedViews ?? []).length === 0
        ? new Set<string>()
        : this.#hiddenTables({ database, protections, views, catalog });
    if (isCallerAccessRejection({ rejection, hiddenTables })) this.#marked.add(error);
  }

  #hiddenTables({
    database,
    protections,
    views,
    catalog,
  }: {
    database: string;
    protections: LangWatchQLProtections;
    views: readonly LangWatchQLViewDefinition[];
    catalog: LwqlCatalogue;
  }): ReadonlySet<string> {
    const visibleTo = (held: LangWatchQLProtections) =>
      catalogShapes.visibleViews({ protections: held, views, catalog });
    return hiddenViewTables({
      database,
      showable: visibleTo(this.#fullGrantOf(catalog)),
      visible: visibleTo(protections),
    });
  }

  #fullGrantOf(catalog: LwqlCatalogue): LangWatchQLProtections {
    const known = this.#fullGrants.get(catalog);
    if (known) return known;
    const derived = fullGrantProtections({ catalog });
    this.#fullGrants.set(catalog, derived);
    return derived;
  }

  /** Whether `error` is the caller's own access refused: marked at the throw site. */
  isCallerAccessRefusal({ error }: { error: unknown }): boolean {
    return typeof error === "object" && error !== null && this.#marked.has(error);
  }

  /** Whether a workbench failure is the caller's own doing: their access or the values sent. */
  isCallerOwnRefusal({ error }: { error: unknown }): boolean {
    return isCallerParameterRefusal({ error }) || this.isCallerAccessRefusal({ error });
  }
}
