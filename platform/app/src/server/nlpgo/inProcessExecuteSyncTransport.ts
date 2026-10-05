/**
 * The execute_sync transport for a caller already running inside the control
 * plane.
 *
 * Two callers: the agent-test turn, which builds the same adapter the scenario
 * child builds but runs it inline in the app process, and the relay route,
 * which is the control plane doing this on a child's behalf. Both reach nlpgo
 * the one way the control plane reaches it, `nlpgoFetch`, so the per-project
 * Lambda, the S3 staging of an oversized body and the internal secret are all
 * resolved in exactly one place.
 *
 * Separate from `execute-sync-transport.ts` on purpose: that module is bundled
 * into the scenario child, and `nlpgoFetch` reaches the AWS SDK and Prisma,
 * neither of which belongs in that bundle.
 */

import type { ExecuteSyncTransport } from "../scenarios/execution/serialized-adapters/execute-sync-transport";
import { nlpgoFetch } from "./nlpgoFetch";
import { createNlpFetchDispatcher } from "./timeouts";

/**
 * Reaches this project's engine from inside the control plane.
 *
 * The caller's `signal` is the only deadline passed down. The adapters already
 * arm a timer of their own and abort that signal with it, and a second
 * deadline inside the transport would raise a failure the adapter cannot
 * recognise as its own timeout and would classify as a transport error
 * instead.
 *
 * The dispatcher is still built from `timeoutMs`, because it is what raises
 * undici's own 300s socket timeouts on a self-hosted install's HTTP lane. It
 * is ignored on the Lambda lane.
 */
export function inProcessExecuteSyncTransport({
  projectId,
}: {
  projectId: string;
}): ExecuteSyncTransport {
  return {
    endpoint: `nlpgo:${projectId}/studio/execute_sync`,
    async post({ event, signal, timeoutMs }) {
      const response = await nlpgoFetch({
        projectId,
        path: "/studio/execute_sync",
        body: event,
        origin: "scenario",
        signal,
        dispatcher: createNlpFetchDispatcher({ timeoutMs }),
        // No causalityDepth and no parentTrace, matching what the child's own
        // post carries: a depth on a scenario run stops ON_MESSAGE monitors
        // firing on the traces it produces, and these runs set `do_not_trace`
        // so the engine emits no spans for them.
      });
      return {
        ok: response.ok,
        status: response.status,
        text: response.text,
      };
    },
  };
}
