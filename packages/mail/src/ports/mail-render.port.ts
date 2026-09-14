import type { TriggerDigestMail } from "../templates/trigger-digest-email.tsx";

/**
 * Rendering port: messages a backend process asks to render. Abstract class
 * allows type-safe dependency injection with test substitution, keeping react-email
 * off worker boot graphs.
 */
export abstract class MailRender {
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
