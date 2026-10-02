/**
 * The person a key-authenticated Langy turn is attributed to. A turn runs as a HUMAN, never as a
 * key: the worker's credentials are minted from the acting user and the conversation is filed under
 * them, so a key whose owner no longer exists cannot start one.
 */
import type { LangyCredentialSession } from "@langwatch/langy-contract";
import type { UserApi } from "@langwatch/user-contract";

/** The one user read a key-authenticated turn needs, from the user module. */
export type LangyActorUserReader = Pick<UserApi, "findById">;

export type LangyActorResolution =
  | { ok: true; session: LangyCredentialSession }
  | { ok: false; reason: "actor-missing"; message: string };

/** Reads the person a key-authenticated turn is filed under. */
export class LangyActorSessionService {
  static create(options: { users: LangyActorUserReader }): LangyActorSessionService {
    return new LangyActorSessionService(options);
  }

  private readonly users: LangyActorUserReader;

  private constructor(options: { users: LangyActorUserReader }) {
    this.users = options.users;
  }

  async resolve(input: { userId: string }): Promise<LangyActorResolution> {
    const user = await this.users.findById({ id: input.userId });
    if (!user) {
      return {
        ok: false,
        reason: "actor-missing",
        message:
          "The user this API key belongs to no longer exists. Langy turns are attributed to a real person, so this key cannot start one.",
      };
    }

    return {
      ok: true,
      session: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
    };
  }
}
