/**
 * Which PostgreSQL named collection each LangWatchQL engine table binds to, the values the app
 * renders into it, and the probes that prove ClickHouse holds them (ADR-159).
 * @see specs/lwql/api.feature
 */

import type { LwqlCollectionState } from "../../../repositories/langwatch-ql-provisioning.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLNames } from "../../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLCatalogShapesService } from "../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLSqlTextService } from "../../../services/langwatch-ql-sql-text.service.ts";
import {
  LangWatchQLPostgresMappingService,
  type PostgresNamedCollection,
} from "./langwatch-ql-postgres-mapping.service.ts";
import { LWQL_POSTGRES_READER_ROLE } from "./langwatch-ql-production-provisioning.service.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();
const postgresMapping = LangWatchQLPostgresMappingService.create();
const sqlText = LangWatchQLSqlTextService.create();

/** The collection a config store delivers; every released chart install binds to this name. */
export const LWQL_RENDERED_NAMED_COLLECTION = "lwql_postgres";

/** Nothing read: every rendered-mode engine table takes the preferred collection. */
export const NO_COLLECTION_STATE: LwqlCollectionState = { available: [], bound: {} };

/** `rendered`: a config store owns user, profile, policies and collection; `sql`: the app does. */
export type LwqlAccessModelMode = "rendered" | "sql";

/** The PostgreSQL endpoint the named collection dials, from `DATABASE_URL`. */
export type LwqlPostgresEndpoint = Readonly<{
  host: string;
  port: number;
  database: string;
}>;

/** The PostgreSQL connection the app expects the named collection to hold. */
export type LwqlPostgresSettings = Readonly<{
  endpoint: LwqlPostgresEndpoint;
  readerPassword: string;
}>;

/**
 * Two reads that together prove the collection holds the app's values: one through the collection,
 * one with the app's own values. The reader role has one password, so both succeeding means the
 * collection carries the app's (#8858).
 */
export interface LwqlCollectionProbe {
  readonly collection: string;
  /** An approved view the engine tables read; reading its structure authenticates. */
  readonly relation: string;
  readonly connection: Omit<PostgresNamedCollection, "collection">;
  /** The schema holding the approved view; provisioning never sets the role's search_path. */
  readonly schema: string;
}

/** The reader role's connection values, which every collection the app renders holds. */
function readerConnection({
  postgres,
}: {
  postgres: LwqlPostgresSettings;
}): Omit<PostgresNamedCollection, "collection"> {
  return {
    host: postgres.endpoint.host,
    port: postgres.endpoint.port,
    database: postgres.endpoint.database,
    user: LWQL_POSTGRES_READER_ROLE,
    password: postgres.readerPassword,
  };
}

/** The named collections engine tables bind to, and the values and probes behind them. */
export class LangWatchQLCollectionBindingService {
  static create(): LangWatchQLCollectionBindingService {
    return new LangWatchQLCollectionBindingService();
  }

  private constructor() {}

  /**
   * Rendered mode keeps `lwql_postgres`: the server's own config store holds it, and released
   * installs bound their engine tables to it, so a rename detaches them on the next restart.
   * In sql mode one server can hold several stacks, so each database gets its own.
   */
  namedCollection({ names, mode }: { names: LangWatchQLNames; mode: LwqlAccessModelMode }): string {
    return mode === "rendered" ? LWQL_RENDERED_NAMED_COLLECTION : `lwql_postgres_${names.database}`;
  }

  /**
   * Both names a rendered-mode engine table may be bound to, preferred first: the one released
   * config stores mount, then the per-database one a server outside the chart may hold.
   */
  renderedCollectionCandidates({ names }: { names: LangWatchQLNames }): string[] {
    return [LWQL_RENDERED_NAMED_COLLECTION, this.namedCollection({ names, mode: "sql" })];
  }

  /**
   * The names config.d delivers beside `lwql_postgres`, so a table a previous config bound to
   * the per-database name still attaches once the pods roll onto this one.
   */
  renderedCollectionAliases({ names }: { names: LangWatchQLNames }): string[] {
    return this.renderedCollectionCandidates({ names }).filter(
      (name) => name !== LWQL_RENDERED_NAMED_COLLECTION,
    );
  }

  /**
   * A rendered-mode engine table keeps its binding while that candidate exists on the server,
   * else takes the first candidate the server holds. With neither visible it takes the
   * preferred name, so the statement fails where the collection is truly absent.
   */
  renderedCollectionFor({
    names,
    table,
    server,
  }: {
    names: LangWatchQLNames;
    table: string;
    server: LwqlCollectionState;
  }): string {
    const candidates = this.renderedCollectionCandidates({ names });
    const bound = server.bound[table];
    if (bound !== undefined && candidates.includes(bound) && server.available.includes(bound)) {
      return bound;
    }
    return (
      candidates.find((name) => server.available.includes(name)) ?? LWQL_RENDERED_NAMED_COLLECTION
    );
  }

  /** The values the app renders into the named collection, in either mode. */
  namedCollectionValues({
    names,
    postgres,
    mode,
  }: {
    names: LangWatchQLNames;
    postgres: LwqlPostgresSettings;
    mode: LwqlAccessModelMode;
  }): PostgresNamedCollection {
    return { collection: this.namedCollection({ names, mode }), ...readerConnection({ postgres }) };
  }

  /** The fingerprint of the collection's values and the schema, which a current table carries. */
  credentialFingerprint({
    postgres,
    schema,
  }: {
    postgres: LwqlPostgresSettings;
    schema: string;
  }): string {
    return postgresMapping.credentialFingerprint({
      connection: readerConnection({ postgres }),
      schema,
    });
  }

  /** The collection an engine table binds to: per table in rendered mode, one in sql mode. */
  collectionFor({
    names,
    mode,
    server,
    table,
  }: {
    names: LangWatchQLNames;
    mode: LwqlAccessModelMode;
    server: LwqlCollectionState;
    table: string;
  }): string {
    return mode === "rendered"
      ? this.renderedCollectionFor({ names, table, server })
      : this.namedCollection({ names, mode });
  }

  /** What to read through `collection` before stamping an engine table with the app's values. */
  collectionProbe({
    collection,
    postgres,
    schema,
  }: {
    collection: string;
    postgres: LwqlPostgresSettings;
    schema: string;
  }): LwqlCollectionProbe {
    const [first] = catalogShapes.postgresViews(LWQL_VIEW_CATALOG);
    if (!first) throw new Error("lwql self-provisioning: the catalog maps no PostgreSQL dataset");
    sqlText.assertIdentifier(collection, "named collection");
    return {
      collection,
      relation: first.postgres.approvedView,
      connection: readerConnection({ postgres }),
      schema,
    };
  }

  /** One probe per distinct collection the given engine tables bind to. */
  collectionProbes({
    names,
    postgres,
    schema,
    mode,
    server,
    engineTables,
  }: {
    names: LangWatchQLNames;
    postgres: LwqlPostgresSettings;
    schema: string;
    mode: LwqlAccessModelMode;
    server: LwqlCollectionState;
    engineTables: readonly string[];
  }): LwqlCollectionProbe[] {
    const collections = new Set(
      engineTables.map((table) => this.collectionFor({ names, mode, server, table })),
    );
    return [...collections].map((collection) =>
      this.collectionProbe({ collection, postgres, schema }),
    );
  }
}
