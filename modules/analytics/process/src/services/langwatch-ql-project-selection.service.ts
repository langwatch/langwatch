import {
  LangWatchQLProjectNotFoundError,
  type LangWatchQLCaller,
  type LangWatchQLMemberWindow,
} from "@langwatch/analytics-contract";
import { ValidationError } from "@langwatch/handled-error";

/** The members an aggregate's statement runs over, and where each is read from. */
type MemberScope = Readonly<{
  projects: readonly LangWatchQLCaller[];
  memberWindows: readonly LangWatchQLMemberWindow[];
}>;

/** Which projects a request names, and how an aggregate narrows to them. */
export class LangWatchQLProjectSelectionService {
  static create(): LangWatchQLProjectSelectionService {
    return new LangWatchQLProjectSelectionService();
  }

  private constructor() {}

  /**
   * The projects a request names: `projects`, or the one `projectId`; none when it names none.
   * @throws {ValidationError} when it names both, which no door accepts.
   */
  select({
    projectId,
    projects,
  }: {
    projectId?: string | undefined;
    projects?: readonly string[] | undefined;
  }): { named: readonly string[] | undefined } {
    if (projectId !== undefined && projects !== undefined) {
      throw new ValidationError("send projectId or projects, not both");
    }

    return { named: projects ?? (projectId === undefined ? undefined : [projectId]) };
  }

  /**
   * An aggregate's members cut to the projects a card names. A name outside the aggregate
   * refuses the run with the one id-free answer, as an unreadable project does.
   * @throws {LangWatchQLProjectNotFoundError} for a name that is not a member.
   */
  narrowAggregate({
    aggregate,
    named,
  }: {
    aggregate: MemberScope;
    named: readonly string[];
  }): MemberScope {
    const wanted = new Set(named);
    const projects = aggregate.projects.filter((member) => wanted.has(member.id));
    if (projects.length < wanted.size) throw new LangWatchQLProjectNotFoundError();

    return {
      projects,
      memberWindows: aggregate.memberWindows.filter((window) => wanted.has(window.projectId)),
    };
  }
}
