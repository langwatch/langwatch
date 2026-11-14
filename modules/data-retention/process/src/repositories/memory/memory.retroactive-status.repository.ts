import { emptyRetroactiveStatus } from "../../rules/retroactive-status.rules.ts";
import {
  type IssuedRetroactiveTargets,
  issuedRetroactiveTargetsSchema,
  type RetroactiveStatus,
  type RetroactiveStatusRepository,
  retroactiveStatusSchema,
} from "../retroactive-status.repository.ts";

/** The status rows in memory, parsed on the way in and out like the Postgres store. */
export class MemoryRetroactiveStatusRepository implements RetroactiveStatusRepository {
  static create(): MemoryRetroactiveStatusRepository {
    return new MemoryRetroactiveStatusRepository();
  }

  readonly #rows = new Map<string, RetroactiveStatus>();

  private constructor() {}

  async getForProject(input: { projectId: string }): Promise<RetroactiveStatus> {
    const row = this.#rows.get(input.projectId);
    return row ? retroactiveStatusSchema.parse(row) : emptyRetroactiveStatus(input);
  }

  async save(status: RetroactiveStatus): Promise<void> {
    const parsed = retroactiveStatusSchema.parse(status);
    const issued = this.#rows.get(parsed.projectId)?.issued ?? [];
    this.#rows.set(parsed.projectId, { ...parsed, issued });
  }

  async saveIssued(input: {
    projectId: string;
    issued: IssuedRetroactiveTargets[];
  }): Promise<void> {
    const current = await this.getForProject(input);
    const issued = input.issued.map((entry) => issuedRetroactiveTargetsSchema.parse(entry));
    this.#rows.set(input.projectId, { ...current, issued });
  }
}
