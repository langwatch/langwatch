export abstract class StripeErrorTranslator {
  abstract translate(error: unknown): unknown;
}
