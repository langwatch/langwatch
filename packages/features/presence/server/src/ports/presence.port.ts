export abstract class PresenceBroadcastPort {
  abstract publish(input: {
    projectId: string;
    event: string;
    channel: "presence_updated" | "presence_cursor";
    rateLimited: boolean;
  }): Promise<void>;
}

export abstract class PresenceDiagnosticsPort {
  abstract warn(message: string, context: Record<string, unknown>): void;
}
