/**
 * The project half of a navigate address: every fallback URL is built under the
 * asking project's own slug, so the slug is read once, from the project the
 * turn belongs to, and never from anything the agent wrote.
 */
export abstract class LangyNavigateProjectPort {
  /** The project's slug, or null when it cannot be read. */
  abstract trySlugOf(projectId: string): Promise<string | null>;
}
