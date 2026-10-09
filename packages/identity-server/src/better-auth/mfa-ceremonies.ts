import { createLogger } from "@langwatch/observability";
import type { MfaEnrollmentRepository } from "../mfa-enrollment.repository";
import { mfaCeremonyCommandId, newMfaEnrollmentId } from "../mfa-id";
import type { MfaService } from "../mfa.service";

const logger = createLogger("langwatch:better-auth:mfa-ceremonies");

/**
 * What a two-factor endpoint call MEANS in identity terms (D06), bound to
 * better-auth's own endpoint hooks.
 *
 * The two-factor plugin owns the protocol end to end: it issues the shared
 * secret, checks the codes, stores the backup codes encrypted at rest, counts
 * failures and decides when to lock out. None of that is re-implemented here
 * and none of it can be, because nothing on this class ever sees a secret or
 * a code. What this does is state the LIFECYCLE fact the call implies, so the
 * `MfaEnrollment` aggregate is a record of what happened rather than an
 * aggregate nothing ever writes to.
 *
 * ENDPOINT hooks rather than database hooks, and the reason is mechanical:
 * better-auth's `databaseHooks` do not fire for a plugin's own tables, so a
 * `TwoFactor` row appearing is invisible to the identity ceremonies that
 * handle `Account` and `User`. The endpoints are where the intent is anyway —
 * a row appearing cannot tell you whether somebody started a setup or an
 * administrator reset one.
 *
 * Every method is IDEMPOTENT through the guards rather than through a check
 * here: a ceremony that restates what the projection already carries costs no
 * event. That is what makes better-auth's own retry of a transient endpoint
 * failure free, and it is why the command id is derived from the person, the
 * verb and the moment rather than minted fresh.
 *
 * Every method is also BEST-EFFORT. The endpoint has already answered by the
 * time these run — the person's setup is enabled, their code was accepted —
 * so a failure to state the fact is logged and swallowed. Failing here would
 * turn a successful sign-in into an error for a record-keeping problem the
 * person cannot act on.
 */
export interface MfaCeremoniesDeps {
  mfa: MfaService;
  enrollments: MfaEnrollmentRepository;
  /**
   * How many backup codes a set holds. Ours to state because it is ours to
   * configure — the same number the two-factor plugin is registered with, so
   * "how many are left" subtracts from a count we issued rather than from one
   * we guessed. A count, never a code.
   */
  backupCodeCount: number;
  now: () => number;
}

/** Who did it, in the identity actor vocabulary. */
type CeremonyActor = { type: "user"; id: string } | { type: "system"; id: string };

export class MfaCeremonies {
  constructor(private readonly deps: MfaCeremoniesDeps) {}

  /**
   * `/two-factor/enable` answered: a setup was started and a secret issued.
   *
   * PENDING, not ENABLED. The secret exists but nobody has proved they can
   * read it yet, and the difference is the whole reason the state machine has
   * two states before it has one.
   */
  async afterEnable({ userId }: { userId: string }): Promise<void> {
    await this.attempt({
      verb: "enroll",
      userId,
      run: async ({ occurredAtMs, actor }) => {
        await this.deps.mfa.enrollMfa({
          tenantId: userId,
          userId,
          commandId: this.commandId({ userId, verb: "enroll", occurredAtMs }),
          enrollmentId: newMfaEnrollmentId(),
          method: "totp",
          occurredAtMs,
          actor,
        });
      },
    });
  }

  /**
   * `/two-factor/verify-totp` answered successfully.
   *
   * The same endpoint serves two different moments — finishing a setup, and
   * answering the challenge at every sign-in afterwards — and this states the
   * first. It does not have to tell them apart: the confirm guard states
   * nothing for an enrollment that is already ENABLED, so an ordinary
   * sign-in's challenge costs no event.
   */
  async afterVerifyTotp({ userId }: { userId: string }): Promise<void> {
    const enrollment = await this.deps.enrollments.findEnrollment({ userId });
    if (enrollment.state !== "PENDING" || !enrollment.enrollmentId) return;
    await this.attempt({
      verb: "confirm",
      userId,
      run: async ({ occurredAtMs, actor }) => {
        await this.deps.mfa.confirmMfa({
          tenantId: userId,
          userId,
          commandId: this.commandId({ userId, verb: "confirm", occurredAtMs }),
          enrollmentId: enrollment.enrollmentId as string,
          backupCodeCount: this.deps.backupCodeCount,
          occurredAtMs,
          actor,
        });
      },
    });
  }

  /**
   * `/two-factor/verify-backup-code` answered successfully: one code is gone.
   *
   * The POSITION recorded is the ordinal of the consumption — the first code
   * spent is position 0, the second is 1 — and that is a deliberate reading
   * of "which position", not a shortcut. The plugin removes a used code from
   * its own list rather than marking it, so there is no stable index it could
   * tell us even if we asked, and the ordinal is what makes "a code works
   * exactly once" and "how many are left" both true.
   */
  async afterVerifyBackupCode({ userId }: { userId: string }): Promise<void> {
    const enrollment = await this.deps.enrollments.findEnrollment({ userId });
    if (enrollment.state !== "ENABLED" || !enrollment.enrollmentId) return;
    const codeIndex = enrollment.consumedBackupCodeIndexes.length;
    await this.attempt({
      verb: "consume-backup-code",
      userId,
      run: async ({ occurredAtMs }) => {
        await this.deps.mfa.consumeBackupCode({
          tenantId: userId,
          userId,
          commandId: this.commandId({
            userId,
            verb: `consume-backup-code:${codeIndex}`,
            occurredAtMs,
          }),
          codeIndex,
          occurredAtMs,
        });
      },
    });
  }

  /** `/two-factor/generate-backup-codes` answered: a fresh set replaced the old. */
  async afterGenerateBackupCodes({
    userId,
  }: {
    userId: string;
  }): Promise<void> {
    await this.attempt({
      verb: "regenerate-backup-codes",
      userId,
      run: async ({ occurredAtMs, actor }) => {
        await this.deps.mfa.regenerateBackupCodes({
          tenantId: userId,
          userId,
          commandId: this.commandId({
            userId,
            verb: "regenerate-backup-codes",
            occurredAtMs,
          }),
          backupCodeCount: this.deps.backupCodeCount,
          occurredAtMs,
          actor,
        });
      },
    });
  }

  /**
   * `/two-factor/disable` answered: it is off.
   *
   * `via` says WHO — the person having re-proved a password and a code, or an
   * administrator resetting it for somebody whose authenticator is gone. The
   * distinction is the audit trail's whole point, so it is stated by the
   * caller rather than inferred from the actor's shape.
   */
  async afterDisable({
    userId,
    via = "password+totp",
    actor,
  }: {
    userId: string;
    via?: "password+totp" | "org-admin";
    actor?: CeremonyActor;
  }): Promise<void> {
    await this.attempt({
      verb: "disable",
      userId,
      actor,
      run: async ({ occurredAtMs, actor: resolvedActor }) => {
        await this.deps.mfa.disableMfa({
          tenantId: userId,
          userId,
          commandId: this.commandId({ userId, verb: "disable", occurredAtMs }),
          via,
          // The guard reads the requiring organizations itself; anything
          // stated here would be a caller's opinion about somebody else's
          // memberships.
          requiringOrganizationSlugs: [],
          occurredAtMs,
          actor: resolvedActor,
        });
      },
    });
  }

  private commandId({
    userId,
    verb,
    occurredAtMs,
  }: {
    userId: string;
    verb: string;
    occurredAtMs: number;
  }): string {
    return mfaCeremonyCommandId({ userId, verb, occurredAtMs });
  }

  /**
   * Run one ceremony, and never let it break the endpoint that already
   * answered.
   */
  private async attempt({
    verb,
    userId,
    actor,
    run,
  }: {
    verb: string;
    userId: string;
    actor?: CeremonyActor;
    run: (args: {
      occurredAtMs: number;
      actor: CeremonyActor;
    }) => Promise<void>;
  }): Promise<void> {
    try {
      await run({
        occurredAtMs: this.deps.now(),
        actor: actor ?? { type: "user", id: userId },
      });
    } catch (error) {
      logger.warn(
        { error, userId, verb },
        "two-step verification ceremony could not state its fact; the endpoint already succeeded and the person is unaffected",
      );
    }
  }
}
