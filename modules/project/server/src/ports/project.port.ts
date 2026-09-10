export abstract class ProjectCredentials {
  abstract generateProjectId(): string;
  abstract generateApiKey(): string;
}

export abstract class ProjectKeyMap {
  abstract syncProject(input: { projectId: string; lwqlKey: string }): Promise<void>;
}

export abstract class ProjectStoredObjects {
  abstract deleteOwnedBy(input: { projectId: string }): Promise<void>;
}

export abstract class ProjectDiagnostics {
  abstract error(context: Record<string, unknown>, message: string): void;
  abstract capture(error: Error, context: Record<string, unknown>): void;
}
