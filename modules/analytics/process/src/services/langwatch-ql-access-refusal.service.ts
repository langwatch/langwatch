import type { LangWatchQLProtections } from "@langwatch/analytics-contract";

import type { RejectedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";
import {
  fullGrantProtections,
  hiddenViewTables,
  isCallerAccessRejection,
  isGatedAccessRefusal,
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
    const visibleTo = (held: LangWatchQLProtections) =>
      catalogShapes.visibleViews({ protections: held, views, catalog });
    const hiddenTables = hiddenViewTables({
      database,
      showable: visibleTo(fullGrantProtections({ catalog })),
      visible: visibleTo(protections),
    });
    if (isCallerAccessRejection({ rejection, hiddenTables })) this.#marked.add(error);
  }

  /** Whether `error` is the caller's own access refused: marked at the throw site, or gated. */
  isCallerAccessRefusal({ error }: { error: unknown }): boolean {
    if (typeof error === "object" && error !== null && this.#marked.has(error)) return true;
    return isGatedAccessRefusal({ error });
  }
}

/** The one ledger the throw site writes and both report paths read. */
export const langWatchQLAccessRefusals = LangWatchQLAccessRefusalService.create();
