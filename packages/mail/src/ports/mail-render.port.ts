import type { TriggerDigestMail } from "../templates/trigger-digest-email";

/**
 * The messages a backend process asks this package to render for it.
 *
 * The split is deliberate and it is the one thing that keeps react-email off a
 * worker's boot graph: this package renders, the process sends. A composition
 * root that owns a mail gateway — the no-reply `To`, the BCC fan-out, the
 * unsubscribe footer, the deployment's own host — keeps all of that, and asks
 * for the words rather than writing a second copy of them.
 *
 * It is an abstract class rather than an interface so a process can hold the
 * dependency by type and a test can substitute a renderer without loading
 * react-email at all.
 */
export abstract class MailRenderPort {
  /**
   * The digest an automation sends when its author wrote no template of their
   * own — which is most automations.
   */
  abstract renderTriggerDigest(input: TriggerDigestMail): Promise<string>;

  /** The one nudge sent to admins on the seventh day a join request waits. */
  abstract renderJoinRequestReminder(input: {
    organizationName: string;
    requesterName: string;
    membersSettingsUrl: string;
  }): Promise<string>;

  /** The quiet notice a requester gets when nobody answered in two weeks. */
  abstract renderJoinRequestExpiry(input: { organizationName: string }): Promise<string>;
}
