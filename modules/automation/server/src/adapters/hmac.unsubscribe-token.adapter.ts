import {
  UnsubscribeTokenVerifier,
  type UnsubscribeTokenPayload,
} from "../ports/unsubscribe-token.port.ts";
import { UnsubscribeTokenService } from "../services/unsubscribe-token.service.ts";

/**
 * The verifier every process composes over the one token format.
 *
 * It exists so a composition root supplies a key and nothing else: the format
 * itself is the feature's (`UnsubscribeTokenService`), and a root that
 * re-implemented the verify half would be free to disagree with the sign half
 * that minted the link.
 */
export class HmacUnsubscribeTokenAdapter extends UnsubscribeTokenVerifier {
  static create(input: { secret: string | undefined }): HmacUnsubscribeTokenAdapter {
    return new HmacUnsubscribeTokenAdapter(UnsubscribeTokenService.create(input));
  }

  private constructor(private readonly tokens: UnsubscribeTokenService) {
    super();
  }

  tryVerify(token: string): UnsubscribeTokenPayload | null {
    return this.tokens.tryVerify(token);
  }
}
