import type { AutomationDatabase } from "../../ports/automation-database.port";
import {
  EmailSuppressionNameRepository,
  type UnsubscribeNames,
} from "../email-suppression-name.repository";
export class PrismaEmailSuppressionNameRepository extends EmailSuppressionNameRepository {
  private constructor(private readonly database: AutomationDatabase) {
    super();
  }
  static create(database: AutomationDatabase): PrismaEmailSuppressionNameRepository {
    return new PrismaEmailSuppressionNameRepository(database);
  }
  async tryLookupNames(input: {
    projectId: string;
    triggerId: string | null;
  }): Promise<UnsubscribeNames | null> {
    const project = await this.database.project.findFirst({
      where: { id: input.projectId },
      select: { name: true },
    });
    if (project === null) return null;
    const trigger =
      input.triggerId === null
        ? null
        : await this.database.trigger.findFirst({
            where: { id: input.triggerId, projectId: input.projectId },
            select: { name: true },
          });
    const projectName = (project as { name: string }).name;
    const triggerName = trigger === null ? null : (trigger as { name: string }).name;
    return { projectName, triggerName };
  }
  async findTriggerNames(input: {
    projectId: string;
    triggerIds: string[];
  }): Promise<Map<string, string>> {
    if (input.triggerIds.length === 0) return new Map();
    const rows = await this.database.trigger.findMany({
      where: { id: { in: input.triggerIds }, projectId: input.projectId },
      select: { id: true, name: true },
    });
    return new Map(
      rows.map((row: unknown) => {
        const value = row as { id: string; name: string };
        return [value.id, value.name] as const;
      }),
    );
  }
}
