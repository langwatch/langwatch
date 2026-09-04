export class TraceSafeJsonService {
  static create(): TraceSafeJsonService {
    return new TraceSafeJsonService();
  }

  static safeJsonParse(json: string | null): Record<string, unknown> | null {
    if (!json) {
      return null;
    }

    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }
}
