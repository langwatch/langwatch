/**
 * The two messages an invitation puts in somebody's inbox. A port rather than a call into
 * `@langwatch/mail`, since rendering is react-email and `frontend-boundary.unit.test.ts` bans a
 * value-import chain from a backend process to React. Absent is a supported state, not degraded.
 */
export interface OrganizationInviteMail {
  /**
   * The invitation itself, carrying the already-built accept URL.
   * `projectCount` and `inviter` are optional — reads a process may not have
   * composed — since a message that says less is the supported state.
   */
  sendInvite(
    input: Readonly<{
      email: string;
      organization: Readonly<{ name: string; projectCount?: number }>;
      inviter?: Readonly<{ name: string }>;
      /** Why this organization came, so the first steps match what it uses us for. */
      firstSteps?: Readonly<{ intent?: "AGENT_GOVERNANCE" | "LLM_OPS" }>;
      acceptInviteUrl: string;
    }>,
  ): Promise<void>;
  /**
   * "Somebody is waiting", to one administrator of the organization. `seats`
   * is passed only when the ceiling is the one this organization bought — an
   * enterprise or negotiated ceiling is not passed since it is not a public number.
   */
  sendInviteReRequest(
    input: Readonly<{
      adminEmail: string;
      organizationName: string;
      invitedEmail: string;
      membersSettingsUrl: string;
      seats?: Readonly<{ used: number; ceiling: number }>;
    }>,
  ): Promise<void>;
}

/**
 * The two messages an invitation puts in somebody's inbox. Who is invited and what the accept URL
 * is are the invitation service's decisions; the envelope and template are the mail
 * composition's. The memory tier records and sends nothing.
 */
export abstract class OrganizationInviteMailChannel implements OrganizationInviteMail {
  abstract sendInvite(input: Parameters<OrganizationInviteMail["sendInvite"]>[0]): Promise<void>;
  abstract sendInviteReRequest(
    input: Parameters<OrganizationInviteMail["sendInviteReRequest"]>[0],
  ): Promise<void>;
}
