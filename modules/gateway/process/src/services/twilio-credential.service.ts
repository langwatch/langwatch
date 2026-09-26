/**
 * Reads the stored Twilio credential for one provider row (main's `getTwilioCredential`). A
 * headless voice run and the run-audio door have no session to authorize `ModelProviderService`
 * with, so this keeps the row read and decryption out of the runner.
 */
import {
  GatewayVoiceKeyMissingError,
  type GatewayTwilioCredential,
} from "@langwatch/gateway-contract";

import type { ElevenLabsCredentialCollaborators } from "./gateway-elevenlabs-credential.service.ts";

export class TwilioCredentialService {
  private constructor(private readonly collaborators: ElevenLabsCredentialCollaborators) {}

  static create(collaborators: ElevenLabsCredentialCollaborators): TwilioCredentialService {
    return new TwilioCredentialService(collaborators);
  }

  /** A call needs all three keys; a half-configured row throws `voice_key_missing`. */
  async getCredential(input: { modelProviderId: string }): Promise<GatewayTwilioCredential> {
    const provider = await this.collaborators.providers.findProviderRow(input);
    if (provider?.provider !== "twilio") throw new GatewayVoiceKeyMissingError();
    const keys = this.collaborators.credentials.readCustomKeys(provider.customKeys);
    const accountSid = keys.TWILIO_ACCOUNT_SID;
    const authToken = keys.TWILIO_AUTH_TOKEN;
    const fromNumber = keys.TWILIO_FROM_NUMBER;
    if (typeof accountSid !== "string" || accountSid.length === 0) {
      throw new GatewayVoiceKeyMissingError();
    }
    if (typeof authToken !== "string" || authToken.length === 0) {
      throw new GatewayVoiceKeyMissingError();
    }
    if (typeof fromNumber !== "string" || fromNumber.length === 0) {
      throw new GatewayVoiceKeyMissingError();
    }
    return { accountSid, authToken, fromNumber };
  }
}
