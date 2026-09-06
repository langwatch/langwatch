/**
 * Where one resource is read in the product, answered with the project's own
 * access.
 */

/*
 * A port rather than eight imports: the rows a navigate destination names
 * belong to eight other features, and only the composition root holds them all.
 */

/*
 * It answers with a project-relative PATH because the address a resource is
 * read at is that feature's own — the same one its REST door hands out as
 * `platformUrl` — never something Langy composes.
 */
import type { LangyNavigateResourceKind } from "../rules/langy-navigate-resources.rules.ts";

export abstract class LangyNavigateResourcePort {
  /**
   * The project-relative path this resource is read at, or null when nothing in
   * this project answers to the id.
   */
  abstract tryLocate(input: {
    projectId: string;
    kind: LangyNavigateResourceKind;
    resourceId: string;
  }): Promise<string | null>;
}
