/** Generates opaque AuthZ binding identifiers for API-key grants. */
export abstract class ApiKeyBindingIdPort {
  abstract generateBindingId(): string;
}
