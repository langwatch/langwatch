/** One hop of an approved view's tenant join chain, rendered by the view body. */
export interface PostgresApprovedViewJoin {
  /** Relation joined (application table name). */
  readonly relation: string;
  /** Alias this hop's relation gets in the view body. */
  readonly alias: string;
  /** `<previous alias>.<from> = <alias>.<to>`. */
  readonly on: { readonly from: string; readonly to: string };
}

/** The three tenant scopes as reusable join chains, plus a parent prefixer. */
export function projectTenantPath(): readonly PostgresApprovedViewJoin[] {
  return [];
}

export function teamTenantPath(): readonly PostgresApprovedViewJoin[] {
  return [{ relation: "Project", alias: "p", on: { from: "teamId", to: "teamId" } }];
}

export function organizationTenantPath(): readonly PostgresApprovedViewJoin[] {
  return [
    { relation: "Team", alias: "t", on: { from: "organizationId", to: "organizationId" } },
    { relation: "Project", alias: "p", on: { from: "id", to: "teamId" } },
  ];
}

export function parentTenantPath({
  parent,
  foreignKey,
  alias,
  tail,
}: {
  /** The parent relation the base table's foreign key points at. */
  parent: string;
  /** The base table's column holding the parent's `id`. */
  foreignKey: string;
  /** Alias the parent relation gets — distinct from the tail's aliases. */
  alias: string;
  /** The parent's own scope hops, appended after the parent hop. */
  tail: readonly PostgresApprovedViewJoin[];
}): readonly PostgresApprovedViewJoin[] {
  return [{ relation: parent, alias, on: { from: foreignKey, to: "id" } }, ...tail];
}
