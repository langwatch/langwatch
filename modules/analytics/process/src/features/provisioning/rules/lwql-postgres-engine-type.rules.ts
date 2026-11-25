/**
 * The type a PostgreSQL-engine column is declared with, from its catalogue type. The engine reads
 * a Postgres `timestamp(3)` into `DateTime64(3)` at the wrong scale (year 2299) and correctly into
 * `DateTime64(6)`, so every date widens here and the view casts it back (langwatch/tasks#958).
 */
export function postgresEngineColumnType(catalogueType: string): string {
  return catalogueType.replaceAll(/DateTime64\(\d+/g, "DateTime64(6");
}
