/**
 * What one viewer may see of one project. The title is the one value the model
 * wrote FROM the conversation, so it travels under content visibility.
 */
export type CodingAgentViewerVisibility = Readonly<{
  /** Whether the generated session titles are readable. */
  canReadCapturedContent: boolean;
  /** Whether spend is readable, the `cost:view` cut. */
  canSeeCosts: boolean;
}>;

/**
 * Resolves one viewer's protections over one project. Throws when the policy
 * cannot be resolved at all; a read spanning several projects takes that as
 * "not visible" for the one it asked about, fail-closed.
 */
export abstract class CodingAgentViewerVisibilityPort {
  abstract readVisibility(input: {
    userId: string;
    projectId: string;
  }): Promise<CodingAgentViewerVisibility>;
}
