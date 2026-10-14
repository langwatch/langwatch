/**
 * A refresh token's one rotation across every server, minted once and its pair shared sealed for
 * the replay window (`mintOnce`, ARCHITECTURE.md §7).
 * @see modules/auth/specs/cli-project-session.feature
 */
import { CliDeviceFlowRefusedError } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import {
  SharedCredentialPendingError,
  mintOnce,
  type SharedCredentialStore,
} from "@langwatch/secrets/shared-credential";

import {
  ROTATION_REPLAY_SECONDS,
  cliRememberedRotationSchema,
  rotationReplayAddress,
  type CliRememberedRotation,
} from "../rules/cli-device-session.rules.ts";

const logger = createLogger("langwatch:auth-cli");

/** The refusal a refresh token the store no longer honours answers; the CLI wipes local state. */
export function spentRefreshToken(): CliDeviceFlowRefusedError {
  return new CliDeviceFlowRefusedError({
    refusal: { error: "invalid_grant", error_description: "Refresh token is invalid or revoked" },
    httpStatus: 401,
  });
}

/** The shared value as JSON, or `undefined` when it does not parse, so the schema refuses it. */
function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** What one rotation under the claim came to: a rotated pair to share, or a fork never shared. */
export type CliRotationOutcome =
  | Readonly<{ rotated: CliRememberedRotation }>
  | Readonly<{ forked: CliRememberedRotation }>;

/** The pair a presentation is answered; `replayed` when another presentation minted it. */
export type CliRotationAnswer = Readonly<{ session: CliRememberedRotation; replayed: boolean }>;

/** Carries a fork out of `mintOnce` without holding it: a fork leaves its parent live. */
class ForkedRotation extends Error {
  override readonly name = "ForkedRotation";

  constructor(readonly child: CliRememberedRotation) {
    super("The rotation forked a re-scoped child session");
  }
}

/** One rotation per refresh token on every server, and its pair for a retry in the window. */
export class CliDeviceRotationReplayService {
  static create({
    rotations,
  }: {
    rotations: SharedCredentialStore;
  }): CliDeviceRotationReplayService {
    return new CliDeviceRotationReplayService(rotations);
  }

  private constructor(private readonly rotations: SharedCredentialStore) {}

  /**
   * The first presentation claims the token and runs `rotate`; every other one, a retry or a
   * concurrent one, waits up to the 10 s read-your-writes window and is answered that same pair.
   * Nothing shared in that wait is refused as a spent token, as before.
   */
  async rotateOnce({
    refreshToken,
    rotate,
  }: {
    refreshToken: string;
    /** Rotates under the claim; `remember` shares the pair before the old token is dropped. */
    rotate: (
      remember: (rotated: CliRememberedRotation) => Promise<void>,
    ) => Promise<CliRotationOutcome>;
  }): Promise<CliRotationAnswer> {
    const shared = (rotated: CliRememberedRotation) => ({
      value: JSON.stringify(rotated),
      ttlMs: ROTATION_REPLAY_SECONDS * 1000,
    });
    let minted: CliRememberedRotation | undefined;
    try {
      const value = await mintOnce({
        store: this.rotations,
        address: rotationReplayAddress(refreshToken),
        onUnreadable: (error) => logger.warn({ error }, "a shared refresh rotation cannot be read"),
        mint: async ({ hold }) => {
          const outcome = await rotate((rotated) => hold(shared(rotated)));
          if ("forked" in outcome) throw new ForkedRotation(outcome.forked);
          minted = outcome.rotated;
          return shared(minted);
        },
      });
      if (minted) return { session: minted, replayed: false };
      const remembered = cliRememberedRotationSchema.safeParse(parsedJson(value));
      if (!remembered.success) throw spentRefreshToken();

      return { session: remembered.data, replayed: true };
    } catch (error) {
      if (error instanceof ForkedRotation) return { session: error.child, replayed: false };
      if (error instanceof SharedCredentialPendingError) throw spentRefreshToken();
      throw error;
    }
  }
}
