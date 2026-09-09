/**
 * The slug a new project is given. A slug is the project's segment in every URL the customer
 * ever sees, so it has to survive being typed, pasted and linked: ASCII, lowercase, no
 * punctuation, no leading or trailing dashes.
 */

/**
 * Top-level routes a slug must never collide with. The id suffix makes a collision impossible
 * today; this is the guard for the day somebody drops the suffix, and a project that shadowed
 * `/settings` would be a routing bug nobody could undo without breaking the customer's links.
 */
const RESERVED_TOP_LEVEL_ROUTES = new Set([
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

const PROJECT_ID_SLUG_CHARS = 6;

export class ProjectSlugService {
  static create(): ProjectSlugService {
    return new ProjectSlugService();
  }

  static mint(name: string, projectId: string): string {
    const slug = `${ProjectSlugService.slugify(name)}-${projectId.substring(0, PROJECT_ID_SLUG_CHARS)}`;
    if (RESERVED_TOP_LEVEL_ROUTES.has(slug)) {
      throw new Error(`Minted project slug "${slug}" equals a reserved top-level route`);
    }

    return slug;
  }

  private static slugify(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replaceAll(/[:?&_]/g, "-")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  }
}
