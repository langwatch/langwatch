/**
 * Where the tenant capability travels, and where it must never be read again (ADR-200).
 * @see specs/lwql/isolation.feature
 */

/** A custom setting name, and the capability: sha256 hex, comma-joined for a project set. */
const TENANT_SETTING_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TENANT_CAPABILITY = /^[0-9a-f,]*$/;
/** A project id as the query log may name it: the characters ids are minted from. */
const PROJECT_ID = /^[A-Za-z0-9_-]+$/;
const HIDDEN = "[HIDDEN]";

/** The query log's comment for a run: the projects it is scoped to, never the capability. */
export function lwqlLogComment({ projectIds }: { projectIds: readonly string[] }): string {
  if (projectIds.length === 0 || !projectIds.every((id) => PROJECT_ID.test(id))) {
    throw new Error("A LangWatchQL project id is not safe to name in the query log");
  }
  return `lwql:project=${projectIds.join(",")}`;
}

/**
 * The statement with the capability and the query log's comment in its own trailing SETTINGS
 * clause, in the body and never the URL. The validator refuses a caller's SETTINGS, so this
 * clause is the only one; every value is checked before it is inlined.
 */
export function withTenantCapability({
  sql,
  setting,
  capability,
  projectIds,
}: {
  sql: string;
  setting: string;
  capability: string;
  projectIds: readonly string[];
}): string {
  if (!TENANT_SETTING_NAME.test(setting)) {
    throw new Error("The LangWatchQL tenant setting is not a plain identifier");
  }
  if (!TENANT_CAPABILITY.test(capability)) {
    throw new Error("The LangWatchQL tenant capability is not lowercase hex");
  }
  const comment = lwqlLogComment({ projectIds });
  return `${sql.replace(/[\s;]+$/, "")}\nSETTINGS ${setting} = '${capability}', log_comment = '${comment}'`;
}

/** `text` with the joined capability and each of its hashes replaced, longest first. */
export function withoutTenantCapability({
  text,
  capability,
}: {
  text: string;
  capability: string;
}): string {
  const values = [capability, ...capability.split(",")].filter((value) => value !== "");
  return values.reduce((hidden, value) => hidden.replaceAll(value, HIDDEN), text);
}
