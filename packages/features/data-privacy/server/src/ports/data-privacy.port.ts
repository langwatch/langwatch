import type { ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";

/**
 * The project read a policy resolution is built from.
 *
 * A policy is inherited down organization → team → department → project, and
 * every id on that chain is on the project row read with its team. That one
 * read is the only thing the resolution needs, so it is named here rather than
 * taken as a whole `ProjectService` — which would put the project write graph
 * and, through it, an organization service and an authz service in a process
 * that only redacts spans. `ProjectService` and `ProjectMetadataService` both
 * satisfy this.
 */
export abstract class DataPrivacyProjectPort {
  abstract getWithTeam(id: string): Promise<ProjectWithTeam>;
}

/**
 * The one question the ingestion paths ask of data privacy.
 *
 * `DataPrivacyResolutionService` answers it, and so does the wider
 * `DataPrivacyService` that composes it. Naming it is what lets the span
 * content-drop and PII-redaction services be composed by a process that can
 * resolve a policy but cannot write one.
 */
export abstract class DataPrivacyResolutionPort {
  abstract getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy>;
}
