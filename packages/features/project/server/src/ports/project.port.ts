export abstract class ProjectCredentialsPort {
  abstract generateProjectId(): string;
  abstract generateApiKey(): string;
}

export abstract class ProjectKeyMapPort {
  abstract syncProject(input: { projectId: string; lwqlKey: string }): Promise<void>;
}

export abstract class ProjectStoredObjectsPort {
  abstract deleteOwnedBy(input: { projectId: string }): Promise<void>;
}

export abstract class ProjectDiagnosticsPort {
  abstract error(context: Record<string, unknown>, message: string): void;
  abstract capture(error: Error, context: Record<string, unknown>): void;
}
