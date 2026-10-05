/**
 * POST /api/scenario/execute-sync
 *
 * The control plane running one `execute_flow` on a project's own nlpgo
 * engine, on behalf of a scenario child process.
 *
 * Why this exists. A code or workflow target's turn is executed by an adapter
 * running in the scenario child, which used to post straight to the engine. On
 * SaaS each project has its OWN engine, an AWS Lambda, and invoking it needs a
 * credential that may invoke any project's function and create new ones. That
 * credential cannot go to the child: it is the whole tenant boundary. So on
 * SaaS the child posts here instead, with the project key it already carries,
 * and the control plane makes the invoke.
 *
 * The project is bound from the credential, never from the body. The body is
 * the engine's own event and is forwarded unread apart from a JSON parse, so
 * the `api_key` and `secrets` the adapters put in the DSL arrive unchanged.
 *
 * The answer is nlpgo's own status and body, forwarded as they are. That is
 * the point of the route rather than an implementation detail: the adapters
 * classify every failure they report from exactly those two values (a 200
 * whose `status` is `"error"` is the customer's Python failing; a non-2xx
 * carrying the engine's error envelope is a rejected request; a 2xx that is
 * not JSON is something answering on the engine's behalf). Rewriting either
 * would collapse those into one another.
 *
 * Self-hosted installs never reach this route. Their child posts to
 * `LANGWATCH_NLP_SERVICE` directly, which is unchanged.
 *
 * @see specs/scenarios/execute-sync-relay.feature
 */

import { createLogger } from "@langwatch/observability";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createProjectApp, requires } from "~/server/api/security";
import { nlpgoFetch } from "~/server/nlpgo/nlpgoFetch";
import { resolveMaxFetchTimeoutMs } from "~/server/nlpgo/timeouts";
import {
  LambdaFetchAbortedError,
  LambdaFetchTimeoutError,
} from "~/utils/lambdaFetch";
import { bodyLimit } from "./_lib/body-limit";

const logger = createLogger("langwatch:api:scenario:execute-sync");

/**
 * Matches the inline-media cap on `/api/scenario-events`. A workflow DSL
 * carrying a dataset or a long conversation is large, and the engine's own
 * receiver stages anything past the 6 MiB Lambda invoke cap to S3, so the
 * cap here only has to refuse an abusive body rather than bound a legitimate
 * one.
 */
const EXECUTE_SYNC_MAX_BODY_BYTES = 50 * 1024 * 1024;

const secured = createProjectApp({ basePath: "/api/scenario" });

secured
  .access(requires("scenarios:create"))
  .post(
    "/execute-sync",
    bodyLimit({ maxSize: EXECUTE_SYNC_MAX_BODY_BYTES }),
    async (c) => {
      const project = c.get("project");

      let event: unknown;
      try {
        event = await c.req.json();
      } catch {
        return c.json({ error: "Bad request, expecting a JSON event" }, 400);
      }

      try {
        const response = await nlpgoFetch({
          // The project the credential resolved to. Nothing in the body is
          // consulted for this, so a key for one project cannot run on another
          // project's engine.
          projectId: project.id,
          path: "/studio/execute_sync",
          body: event,
          origin: "scenario",
          // The caller's own socket. A stopped run kills the child, which closes
          // this request, which cancels the invoke instead of leaving the
          // engine running with nothing waiting for it.
          signal: c.req.raw.signal,
          // The platform's ceiling for one turn, so a wedged invoke cannot park
          // this request indefinitely. The child holds a shorter deadline of its
          // own and normally reports the timeout first.
          timeoutMs: resolveMaxFetchTimeoutMs(),
          // Deliberately no causalityDepth: nlpgoFetch sends the header whenever
          // the field is set, even to 0, and a depth on a scenario run stops
          // ON_MESSAGE monitors firing on the traces it produces.
          // Deliberately no parentTrace: these runs set `do_not_trace`, so the
          // engine emits no spans for them and the hop is as it was.
        });

        const body = await response.text();
        return c.body(body, response.status as ContentfulStatusCode);
      } catch (error) {
        if (error instanceof LambdaFetchTimeoutError) {
          logger.warn(
            { projectId: project.id },
            "scenario execute_sync exceeded the platform turn ceiling",
          );
          return c.json({ error: "The engine did not answer in time" }, 504);
        }
        if (error instanceof LambdaFetchAbortedError) {
          // The child is gone, so there is no one to answer. Returning rather
          // than throwing keeps a stopped run out of the unhandled-error log.
          return c.json({ error: "The caller went away" }, 408);
        }
        throw error;
      }
    },
  );

export const app = secured.hono;
