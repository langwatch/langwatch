import { slugify } from "~/utils/slugify";

/**
 * Top-level route prefixes of the app. A project slug equal to one of these
 * would be unreachable: the static route always wins over /:project in the
 * router. The nanoid suffix in mintProjectSlug already makes such a slug
 * impossible; the guard keeps the invariant explicit if the minting ever
 * changes.
 */
export const RESERVED_TOP_LEVEL_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "assets",
  "auth",
  "authorize",
  "cli",
  "gateway",
  "governance",
  "invite",
  "mcp",
  "me",
  "onboarding",
  "ops",
  "settings",
  "share",
  "unsubscribe",
]);

export function assertProjectSlugAllowed({ slug }: { slug: string }): void {
  if (RESERVED_TOP_LEVEL_SLUGS.has(slug)) {
    throw new Error(
      `Minted project slug "${slug}" equals a reserved top-level route`,
    );
  }
}

export function mintProjectSlug({
  name,
  projectNanoId,
}: {
  name: string;
  projectNanoId: string;
}): string {
  const slug =
    slugify(name, { lower: true, strict: true }) +
    "-" +
    projectNanoId.substring(0, 6);
  assertProjectSlugAllowed({ slug });
  return slug;
}
