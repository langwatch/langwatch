/**
 * What the address says the audit table is showing.
 *
 * Every filter this page applies lives in the URL, which is deliberate: a
 * compliance reviewer's whole workflow is sending somebody else the view they
 * are looking at. So the reading is a pure function of the query, and the
 * writes answer with the NEXT WHOLE QUERY rather than performing navigation —
 * the host applies it, and both halves stay assertable without a router.
 */

const DEFAULT_PAGE_SIZE = 25;

/** How far into the trail the table is, and how much of it it shows. */
export type AuditPaging = { pageOffset: number; pageSize: number };

/**
 * A number in the URL, or the default.
 *
 * Negative offsets are clamped to zero rather than sent: `skip: -25` is a
 * database error, and a hand-edited URL should land on the first page.
 */
function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (isNaN(parsed)) return fallback;
  return parsed < 0 ? fallback : parsed;
}

export function readAuditPaging(query: Readonly<Record<string, string | undefined>>): AuditPaging {
  return {
    pageOffset: readNumber(query.pageOffset, 0),
    pageSize: readNumber(query.pageSize, DEFAULT_PAGE_SIZE),
  };
}

/**
 * The gateway deep-link a Virtual Key or Budget detail page arrives with.
 *
 * `/settings/audit-log?targetKind=virtual_key&targetId=vk_xxx` is a link one
 * screen writes and this one reads, so the two spellings are a contract between
 * them.
 */
export type AuditTargetFilter = { targetKind: string; targetId: string } | undefined;

export function readAuditTarget(
  query: Readonly<Record<string, string | undefined>>,
): AuditTargetFilter {
  const targetKind = query.targetKind;
  const targetId = query.targetId;
  if (!targetKind || !targetId) return void 0;
  return { targetKind, targetId };
}

/** The next whole query with the target filter taken back off. */
export function withoutAuditTarget(
  query: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const { targetKind: _kind, targetId: _id, ...rest } = query;
  return rest;
}

/**
 * The next whole query for a changed filter.
 *
 * Paging always resets: page four of the old filter is not page four of the
 * new one, and leaving the offset behind is how a reader lands on an empty
 * table and concludes there is nothing to see.
 */
export function withAuditFilter(
  query: Readonly<Record<string, string | undefined>>,
  updates: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return { ...query, ...updates, pageOffset: "0" };
}

/** The next whole query for a step through the pages. */
export function withAuditPageOffset(
  query: Readonly<Record<string, string | undefined>>,
  pageOffset: number,
): Record<string, string | undefined> {
  return { ...query, pageOffset: String(Math.max(0, pageOffset)) };
}

/** The next whole query for a resized page, which starts the walk over. */
export function withAuditPageSize(
  query: Readonly<Record<string, string | undefined>>,
  pageSize: number,
): Record<string, string | undefined> {
  return { ...query, pageSize: String(pageSize), pageOffset: "0" };
}

/**
 * Where a deep-linked reader came from, when we can say.
 *
 * ONLY KINDS WITH A REAL `[id]` DETAIL ROUTE ARE MAPPED. `provider_binding` and
 * `cache_rule` are list-only surfaces today, so offering a back-link for one
 * would send the reader to a 404 — worse than offering nothing, because it
 * looks like the resource was deleted.
 */
const RESOURCE_ROUTES: Readonly<Record<string, { path: string; label: string }>> = {
  virtual_key: { path: "gateway/virtual-keys", label: "Virtual key" },
  budget: { path: "gateway/budgets", label: "Budget" },
};

export type AuditBackLink = { href: string; label: string } | null;

export function auditBackLink({
  target,
  projectSlug,
}: {
  target: AuditTargetFilter;
  projectSlug: string | undefined;
}): AuditBackLink {
  if (!target || !projectSlug) return null;
  const entry = RESOURCE_ROUTES[target.targetKind];
  if (!entry) return null;
  return { href: `/${projectSlug}/${entry.path}/${target.targetId}`, label: entry.label };
}

/**
 * The user id a typed name or address resolves to.
 *
 * The audit read filters by user id, so the box has to be matched in the
 * browser against the member list the reader is already allowed to see.
 * Undefined for an empty box means "no user filter"; undefined for a box that
 * matched nobody means the same thing, which is the one place this shape is
 * lossy and the reason the screen states the search term beside the table.
 */
export function matchMemberId(
  members: readonly { userId: string; user: { name: string | null; email: string | null } }[],
  search: string,
): string | undefined {
  const needle = search.trim().toLowerCase();
  if (!needle) return void 0;
  return members.find(
    (member) =>
      (member.user.name?.toLowerCase().includes(needle) ?? false) ||
      (member.user.email?.toLowerCase().includes(needle) ?? false),
  )?.userId;
}
