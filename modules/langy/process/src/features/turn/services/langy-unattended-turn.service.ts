/**
 * A turn a module starts for a person who is not at the keyboard, such as a scheduled insights
 * run. It acts as that person as they are now, and it only reads: the turn below it mints an
 * allowlisted key and asks for no GitHub token. ORDER IS THE CONTRACT: every refusal comes first.
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  type LangyStartUnattendedTurnInput,
  LangyUnattendedTurnRefusedError,
} from "@langwatch/langy-contract";
import {
  AggregateProjectIsReadOnlyError,
  isAggregateProjectKind,
  ProjectNotFoundError,
  type ProjectApi,
} from "@langwatch/project-contract";

import { LangyAccessService } from "../../../services/langy-access.service.ts";
import type { LangyActorUserReader } from "../../../services/langy-actor-session.service.ts";
import type { StartConversationTurnInput } from "./langy-turn-shared.service.ts";
import type { LangyTurnsBoundsService } from "./langy-turns-bounds.service.ts";

type UnattendedTurnStart = StartConversationTurnInput & {
  unattended: NonNullable<StartConversationTurnInput["unattended"]>;
};

type LangyUnattendedTurnMembers = Readonly<{
  users: LangyActorUserReader;
  projects: Pick<ProjectApi, "findIdentity">;
  featureFlags: FeatureFlagApi;
  bounds: Pick<LangyTurnsBoundsService, "assertUnattendedTurnWithinBounds">;
  turns: {
    startUnattendedTurn(input: UnattendedTurnStart): Promise<{
      conversationId: string;
      turnId: string;
    }>;
  };
}>;

export class LangyUnattendedTurnService {
  static create(members: LangyUnattendedTurnMembers): LangyUnattendedTurnService {
    return new LangyUnattendedTurnService(members);
  }

  private constructor(private readonly members: LangyUnattendedTurnMembers) {}

  async start(
    input: LangyStartUnattendedTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    const { users, projects, featureFlags, bounds, turns } = this.members;
    const user = await users.findById({ id: input.userId });
    if (!user) throw new LangyUnattendedTurnRefusedError("langy_unattended_actor_missing");
    // Nobody acts for an account that was retired, whatever membership it still holds.
    if (user.deactivatedAt !== null) {
      throw new LangyUnattendedTurnRefusedError("langy_unattended_actor_deactivated");
    }
    const session = { user: { id: user.id, name: user.name, email: user.email } };

    const project = await projects.findIdentity(input.projectId);
    if (!project) throw new ProjectNotFoundError();
    if (isAggregateProjectKind(project.kind)) throw new AggregateProjectIsReadOnlyError();

    const hasAccess = await LangyAccessService.create({ featureFlags }).hasAccess({
      user: session.user,
      projectId: project.id,
      organizationId: project.organizationId,
    });
    if (!hasAccess) throw new LangyUnattendedTurnRefusedError("langy_unattended_no_langy_access");

    // Always a conversation of its own: a run never writes into one the person is chatting in.
    return turns.startUnattendedTurn({
      projectId: project.id,
      idempotencyKey: input.idempotencyKey,
      session,
      requestedConversationId: null,
      messages: [{ role: "user", parts: [{ type: "text", text: input.text }] }],
      isRetry: false,
      turnContext: {},
      unattended: {
        title: input.title,
        // Counted by the turn once it is claimed, so a replay of the same turn counts nothing.
        countTurn: () => bounds.assertUnattendedTurnWithinBounds({ projectId: project.id }),
      },
    });
  }
}
