import type { LangWatchQLProtections } from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";

import type { AcceptedLangWatchQL } from "../rules/langwatch-ql-validation-shape.rules.ts";
import type { LwqlCatalogue } from "../rules/lwql-catalogue.rules.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "./langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLValidationErrorService } from "./langwatch-ql-validation-errors.service.ts";
import { LangWatchQLValidationService } from "./langwatch-ql-validation.service.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();
const lwqlValidationErrors = LangWatchQLValidationErrorService.create();
const logger = createLogger("langwatch:analytics:lwql");

type LangWatchQLPolicyValidationDependencies = Readonly<{
  views: readonly LangWatchQLViewDefinition[];
  catalog: LwqlCatalogue;
}>;

/** The policy half of validation: what this caller may name, refused with the policy's error. */
export class LangWatchQLPolicyValidationService {
  private readonly validation = LangWatchQLValidationService.create();

  static create(
    dependencies: LangWatchQLPolicyValidationDependencies,
  ): LangWatchQLPolicyValidationService {
    return new LangWatchQLPolicyValidationService(dependencies);
  }

  private constructor(private readonly dependencies: LangWatchQLPolicyValidationDependencies) {}

  validate({
    projectId,
    database,
    protections,
    sql,
    isInstantEvalsEnabled,
  }: {
    readonly projectId: string;
    readonly database: string;
    readonly protections: LangWatchQLProtections;
    readonly sql: string;
    readonly isInstantEvalsEnabled: boolean;
  }): AcceptedLangWatchQL {
    const { views, catalog } = this.dependencies;
    const validation = this.validation.validate({
      sql,
      // The datasets this caller can reach, not every dataset the catalog has. A dataset gated
      // as a whole is absent from the schema endpoint, and `allowedTables` is what makes it
      // *unnameable* rather than merely unlisted: derived from the full catalog, a caller could
      // name a hidden dataset and read its row-policed rows despite holding none of the
      // permissions that dataset requires.
      allowedTables: catalogShapes.allowedTables({
        database,
        views: catalogShapes.visibleViews({ protections, views, catalog }),
      }),
      // Derived from the *full* catalog on purpose: a column of a hidden
      // dataset must stay gated so that naming it unqualified — where no table
      // reference reveals which dataset it came from — is refused too.
      gatedColumns: catalogShapes.gatedColumns({ protections, views }),
      // What would lift each of those, so a refusal can say "you may not see this" apart from
      // "this query is broken". It names a permission, never a value.
      gatedColumnGates: catalogShapes.gatedColumnGates({ protections, views }),
      // An app function returning captured content is as restricted as a
      // column holding it, so the gate reads the same permissions.
      heldPermissions: [...catalogShapes.heldPermissions(protections)],
      isInstantEvalsEnabled,
      defaultDatabase: database,
    });

    if (!validation.ok) {
      logger.info(
        {
          projectId,
          violations: validation.violations.map((violation) => violation.code),
        },
        "LangWatchQL refused by policy",
      );

      throw lwqlValidationErrors.forRejection(validation);
    }

    return validation;
  }
}
