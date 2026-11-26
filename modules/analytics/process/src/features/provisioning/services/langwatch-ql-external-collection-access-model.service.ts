/**
 * The access model of a server whose own config holds the PostgreSQL collection (ADR-200): the
 * private SQL path and the private render both read it, so the users.d file matches the statements.
 * @see specs/lwql/api.feature
 */
import { createHash } from "node:crypto";

import {
  LangWatchQLAccessModelDefinitionService,
  type LwqlAccessModelDefinition,
} from "../../../services/langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../../../services/langwatch-ql-access-model.service.ts";
import { LWQL_RENDERED_NAMED_COLLECTION } from "./langwatch-ql-collection-binding.service.ts";

const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();

/** What an external collection leaves in the definition: never rendered, so never a password. */
const NO_NAMED_COLLECTION_VALUES = {
  collection: LWQL_RENDERED_NAMED_COLLECTION,
  host: "",
  port: 0,
  database: "",
  user: "",
  password: "",
};

/** Builds the reader's definition with no connection value: `lwql_postgres` holds it. */
export class LangWatchQLExternalCollectionAccessModelService {
  static create(): LangWatchQLExternalCollectionAccessModelService {
    return new LangWatchQLExternalCollectionAccessModelService();
  }

  private constructor() {}

  /** The reader's definition, its password kept only as a sha256 hex hash. */
  build({
    names,
    restrictedPassword,
    sourceDatabase,
  }: {
    names: LangWatchQLNames;
    restrictedPassword: string;
    sourceDatabase: string;
  }): LwqlAccessModelDefinition {
    return accessModelDefinition.build({
      names,
      passwordSha256Hex: createHash("sha256").update(restrictedPassword).digest("hex"),
      namedCollection: NO_NAMED_COLLECTION_VALUES,
      sourceDatabase,
    });
  }
}
