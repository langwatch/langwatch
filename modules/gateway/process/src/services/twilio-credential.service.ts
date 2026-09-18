/**
 * Reads the stored Twilio credential for one provider row. A headless voice
 * run has no session to authorize `ModelProviderService` with, so this
 * keeps the query and decryption out of the runner. Nothing here throws.
 */

/** The account SID, auth token and origination number a phone run dials with. */
export interface TwilioCredential {
  /** The Twilio account the call is billed to. */
  accountSid: string;
  /** The account auth token. The one secret field of the three. */
  authToken: string;
  /** The account's own Twilio number (E.164) the call originates FROM. */
  fromNumber: string;
}

export interface TwilioProviderReader {
  findById(id: string): Promise<{ provider: string; customKeys: unknown } | null>;
  listAccessible(
    projectId: string,
  ): Promise<readonly { id: string; provider: string; enabled: boolean }[]>;
}

export interface TwilioCredentialReader {
  readCustomKeys(value: unknown): { keys: Record<string, unknown> };
}

export class TwilioCredentialService {
  private constructor(
    private readonly providers: TwilioProviderReader,
    private readonly credentials: TwilioCredentialReader,
  ) {}

  static create(input: {
    providers: TwilioProviderReader;
    credentials: TwilioCredentialReader;
  }): TwilioCredentialService {
    return new TwilioCredentialService(input.providers, input.credentials);
  }

  async findProviderForProject(input: { projectId: string }): Promise<{ id: string } | null> {
    const rows = await this.providers.listAccessible(input.projectId);
    const row = rows.find((candidate) => candidate.provider === "twilio" && candidate.enabled);
    return row?.id ? { id: row.id } : null;
  }

  async findCredential(input: { modelProviderId: string }): Promise<TwilioCredential | null> {
    const provider = await this.providers.findById(input.modelProviderId);
    if (provider?.provider !== "twilio") return null;
    const keys = this.credentials.readCustomKeys(provider.customKeys).keys;
    const accountSid = keys.TWILIO_ACCOUNT_SID;
    const authToken = keys.TWILIO_AUTH_TOKEN;
    const fromNumber = keys.TWILIO_FROM_NUMBER;
    if (typeof accountSid !== "string" || accountSid.length === 0) return null;
    if (typeof authToken !== "string" || authToken.length === 0) return null;
    if (typeof fromNumber !== "string" || fromNumber.length === 0) return null;
    return { accountSid, authToken, fromNumber };
  }
}
