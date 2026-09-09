export abstract class StripeErrorTranslatorPort {
  abstract translate(error: unknown): unknown;
}
