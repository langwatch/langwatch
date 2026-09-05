/**
 * Whether a project may place workbench cards at all.
 *
 * The gate is LangWatchQL's own — a feature flag resolved against the project's
 * organization — so Dashboard takes it as a port the application composes
 * rather than reading Analytics' server package.
 */
export abstract class WorkbenchAccessPort {
  abstract isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
}
