/**
 * The ClickHouse trace read stack, as a port.
 *
 * Its own module because the record type beside the trace composition names
 * it, and that record is reached by every program that names `AppRouter`.
 * Reaching it through the composition would put the composition's adapters,
 * repositories and byte stores into those programs too.
 */
import type { RestCredentialPrincipal } from "@langwatch/api/rest";
import type {
  Protections,
  TraceLegacyFilterInput,
  TraceLegacyListInput,
} from "@langwatch/trace-contract";
import type {
  TraceAppDependencies,
  TraceEditOverlayTrpcPorts,
  TracesTrpcPorts,
  TracesV2TrpcPorts,
} from "@langwatch/trace-server";

/**
 * The ClickHouse trace READ stack, which never left `platform/app` and went with
 * it when the monolith was deleted.
 */
export abstract class ApiTraceReadStackPort {
  /** The ten readers `TraceApp` is composed from. */
  abstract readers(): TraceAppDependencies["traces"];
  /**
   * The caller's read-time redactions for one project: cost visibility, the
   * data-privacy policy's content categories, the restricted-attribute rules
   * and the plan's visibility cutoff.
   */
  abstract getViewerProtections(
    ctx: unknown,
    input: Readonly<{ projectId: string }>,
  ): Promise<Protections>;
  /**
   * The trace-view read ports both the explorer and the anonymous share read
   * carry: the plan window, the span display and redaction passes, Data
   * Privacy's content catalogue and the coding-agent log join.
   */
  abstract readPorts(): Pick<
    TracesV2TrpcPorts,
    "tryGetVisibilityCutoffMs" | "mappers" | "derivedAttrPrefixes" | "codingAgentEnrichment"
  >;
  /**
   * The explorer's own: the AI composer, the reserved-metadata write and its
   * parser, the unmapped-cost suggestion, the prompt-ancestor walk and the
   * application's `trace_not_found`.
   */
  abstract explorerPorts(): Omit<
    TracesV2TrpcPorts,
    | "getViewerProtections"
    | "tryGetVisibilityCutoffMs"
    | "mappers"
    | "derivedAttrPrefixes"
    | "codingAgentEnrichment"
    | "queryTranslation"
  >;
  /**
   * The legacy grid's two shared input schemas, the evaluator inventory's type
   * schema, the precondition rule schema and engine, and the readable digest.
   */
  abstract legacyPorts(): Omit<
    TracesTrpcPorts<TraceLegacyListInput, unknown, TraceLegacyFilterInput, unknown, unknown>,
    "getViewerProtections"
  >;
  /** The two rules a reviewer's correction is carried through. */
  abstract editOverlayRedaction(): Omit<
    TraceEditOverlayTrpcPorts<Protections>,
    "getViewerProtections"
  >;
  /**
   * The share viewer's redactions, computed for the presented session with
   * `publiclyShared` set. Null when the project is gone, which the read turns
   * into the same generic not-found a bad token gets.
   */
  abstract tryGetShareViewerProtections(input: {
    projectId: string;
    session: { user?: { id: string } } | null | undefined;
  }): Promise<Protections | null>;
  /**
   * The redactions an API KEY reads through, for the public REST doors.
   *
   * The credential is part of the question: cost visibility is the key's own
   * grant, not the reach of whoever created it.
   */
  abstract getApiKeyProtections(
    input: Readonly<{ projectId: string; credential: RestCredentialPrincipal }>,
  ): Promise<Protections>;
  /** True when the read's trace no longer exists. */
  abstract isTraceNotFound(error: unknown): boolean;
}
