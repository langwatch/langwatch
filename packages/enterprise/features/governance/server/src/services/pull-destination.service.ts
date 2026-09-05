import { GovernanceValidationError } from "@langwatch/enterprise-governance-contract";
export const DATABRICKS_GENIE_ADAPTER_ID = "databricks_genie" as const;

/**
 * The only hosts a Genie workspace is ever served from, one per cloud.
 *
 * Databricks owns all three, so a customer cannot register a lookalike inside
 * them and no config can name one that is not theirs.
 */
export const DATABRICKS_WORKSPACE_HOST_SUFFIXES = [
  ".azuredatabricks.net",
  ".cloud.databricks.com",
  ".gcp.databricks.com",
] as const;

/**
 * Where a pull is allowed to send a credential.
 *
 * This runs when a source is SAVED, which is deliberately the only place it
 * runs: the rejection has to reach whoever is making the change, and the
 * adapter still has to be pointable at a local fixture by its own tests. The
 * rule and the reasoning for it are one object here; the puller adapter calls
 * it rather than restating it.
 */
export class PullDestinationService {
  static create(): PullDestinationService {
    return new PullDestinationService();
  }

  /**
   * Whether a URL is a Databricks workspace origin we may attach a token to.
   *
   * This is an egress restriction, not a formatting check: the decrypted
   * workspace token goes out as `Authorization: Bearer` to whatever host this
   * string names. A plain `z.string().url()` accepts
   * `https://attacker.example.com`, and `ssrfSafeFetch` will happily reach it —
   * that helper rejects PRIVATE destinations, which is a different threat and
   * no defence against an attacker-owned public host.
   *
   * The reachable path needs no knowledge of the secret: the source's config is
   * readable, the credential travels in it as an opaque encrypted envelope, and
   * re-encryption is deliberately idempotent. So a principal who can edit a
   * source could hand the envelope back unchanged with a different
   * `workspaceUrl`, and the next scheduled run would decrypt a token they never
   * saw and post it to their host.
   */
  static isDatabricksWorkspaceOrigin(value: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    // Plain http would put the token on the wire in clear even for a real
    // workspace, and credentials in the URL are never part of a legitimate one.
    if (url.protocol !== "https:") return false;
    if (url.username !== "" || url.password !== "") return false;
    // A bare origin and nothing else. A workspace URL is a base that the puller
    // appends its own paths to, so anything past the host is not part of a
    // legitimate one — and a port or a path is how a matching host gets pointed
    // at something other than the workspace API.
    if (url.port !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      return false;
    }
    const host = url.hostname.toLowerCase();
    // The host as a hostname is spelt: rejecting anything else keeps this at
    // least as strict as the character check it replaces, so consolidating the
    // two copies cannot have widened what is accepted.
    if (!/^[a-z0-9.-]+$/.test(host)) return false;

    return DATABRICKS_WORKSPACE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  }

  assertAllowed(parserConfig: Record<string, unknown> | null | undefined): void {
    if (!parserConfig || typeof parserConfig !== "object") {
      return;
    }

    if (parserConfig.adapter !== DATABRICKS_GENIE_ADAPTER_ID) {
      return;
    }

    if (
      typeof parserConfig.workspaceUrl !== "string" ||
      !PullDestinationService.isDatabricksWorkspaceOrigin(parserConfig.workspaceUrl)
    ) {
      const message = `Workspace URL must be an https Databricks workspace address, ending in ${PullDestinationService.allowedSuffixes()}.`;

      throw new GovernanceValidationError(message, {
        formErrors: [message],
      });
    }
  }

  /**
   * The allowed suffixes as the customer reads them: "a, b or c".
   *
   * Built from the list the check uses, so a new cloud cannot be added to the
   * rule and left out of what the admin is told to type instead.
   */
  private static allowedSuffixes(): string {
    const suffixes = [...DATABRICKS_WORKSPACE_HOST_SUFFIXES];
    const last = suffixes.pop();

    return suffixes.length === 0 ? (last ?? "") : `${suffixes.join(", ")} or ${last}`;
  }
}
