/**
 * `/api/events/track`, and its `/api/track_event` alias every pre-rename SDK
 * release posts to. The alias is a declared route like any other - its path,
 * method, access policy and error handler all come from
 * `trackedEventLegacyPathRest` - and forwards into the canonical app's own
 * `fetch` rather than redirecting (a 307 drops the body for some clients).
 *
 * Both doors are opened by the SAME call, over the SAME ports: a process that
 * composes no tracked-event ports never calls this function, so it mounts
 * neither the canonical route nor the alias.
 */
import type { MountableRestApp, RestErrorHandler } from "@langwatch/api/rest";
import {
  trackedEventLegacyPathRest,
  trackedEventRest,
  trackedEventRestErrorHandler,
  type TrackedEventLegacyPathApi,
  type TrackedEventPorts,
} from "@langwatch/trace-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** `POST /api/events/track` and its `POST /api/track_event` alias. */
export function mountTrackedEventRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    ports: () => TrackedEventPorts;
    errors: RestErrorHandler;
  }>,
): readonly [MountableRestApp, MountableRestApp] {
  const onError = trackedEventRestErrorHandler(options.errors);

  const canonical = runtime.mount(trackedEventRest.router(), options.ports, { onError });
  const alias = runtime.mount(
    trackedEventLegacyPathRest.router(),
    (): TrackedEventLegacyPathApi => ({ forward: async (request) => canonical.fetch(request) }),
    { onError },
  );

  return [canonical, alias];
}
