/**
 * This process's composition of the two remaining packaged trace REST
 * families (`@langwatch/trace-server`): the deprecated `/api/trace/*`
 * endpoints and the SDK collector. The v1 reads live in
 * `traces-rest.mount.ts`, on the module's own `defineRestRouter` declaration.
 */
import {
  credentialPrincipalOfToken,
  type AppRestSecurity,
  type MountableRestApp,
} from "@langwatch/api/rest";
import type { ShareApi } from "@langwatch/share-contract";
import type { TraceApp } from "@langwatch/trace-server";
import {
  createCollectorRestApp,
  type CollectorRestPorts,
} from "@langwatch/trace-server/api-rest/collector";
import {
  createTraceLegacyRestApp,
  type TraceLegacyCredentialPort,
} from "@langwatch/trace-server/api-rest/trace-legacy";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";

import { API_TRACE_LIST_INPUT } from "../../app/api-trace-read-stack.composition.ts";
import type { ApiTraceReadStack } from "./trace-read-stack.port.ts";
import type { ApiHandlerManagedCredential } from "../../app-rest/api-rest.runtime.ts";

/**
 * The deprecated `/api/trace/search` body. The same vocabulary, parsed STRICTLY — that
 * endpoint has always rejected an unknown key rather than stripping it, and loosening it
 * would silently accept a typo a caller currently gets told about.
 */
const traceLegacySearchBodySchema = API_TRACE_LIST_INPUT.omit({
  projectId: true,
  startDate: true,
  endDate: true,
})
  .extend({
    startDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for startDate",
      }),
    ]),
    endDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for endDate",
      }),
    ]),
    scrollId: z.string().optional().nullable(),
    format: z.enum(["digest", "json"]).optional(),
    llmMode: z.boolean().optional().default(false),
  })
  .strict();

/** What this process supplies the deprecated family. */
export type ApiTraceLegacyRestCollaborators = Readonly<{
  /** The one application the browser's trace surfaces read. */
  traces: () => TraceApp;
  /** The one share ledger a project's links live in. */
  shares: () => ShareApi;
  /** The read stack, for the API key's redactions. */
  reads: ApiTraceReadStack;
  /** The process's one handler-managed credential resolution. */
  credential: ApiHandlerManagedCredential;
}>;

/** `/api/trace/*` and `/api/thread/:id`, bound to this process's graph. */
export function mountTraceLegacyRest(options: {
  security: AppRestSecurity;
  collaborators: ApiTraceLegacyRestCollaborators;
}): MountableRestApp {
  const { traces, shares, reads, credential } = options.collaborators;
  // The resolved token becomes the family's principal here, so its handlers
  // ask a second permission question of the KEY rather than of its holder.
  const resolveCredential: TraceLegacyCredentialPort = async (input) => {
    const auth = await credential({ request: input.request, permission: input.permission });
    if (!auth.ok) return auth;
    return {
      ok: true,
      project: auth.project,
      credential: credentialPrincipalOfToken(auth.resolved),
      markUsed: auth.markUsed,
    };
  };
  return createTraceLegacyRestApp({
    security: options.security,
    ports: {
      credential: resolveCredential,
      traces: () => traces(),
      shares: () => shares(),
      getProtections: (input) => reads.getApiKeyProtections(input),
      searchBodySchema: traceLegacySearchBodySchema,
      // The rendered sentence is what this endpoint has always answered with;
      // the endpoint predates the boundary's structured envelope and a
      // deployed client reads the prose.
      describeValidationError: (error) => fromZodError(error as never).message,
    },
  }).mountable as MountableRestApp;
}

/** `POST /api/collector`, bound to this process's own ingestion. */
export function mountCollectorRest(options: {
  security: AppRestSecurity;
  ports: CollectorRestPorts;
}): MountableRestApp {
  return createCollectorRestApp({
    security: options.security,
    ports: options.ports,
  }).mountable as MountableRestApp;
}
