/**
 * This process's composition of the model playground
 * (`@langwatch/model-provider-server`).
 *
 * The playground streams whatever model the CALLER named through the execution
 * proxy, so it binds to the SAME gateway every other model dispatch on this
 * process resolves through and to the SAME proxy address — a second of either
 * would let the playground answer from a provider row the rest of the product
 * cannot see.
 *
 * Mounted only where this process holds a browser session AND an engine
 * address: the door is `credential: "session"`, and with no proxy to dial
 * every request would fail after the customer had already been shown a
 * streaming response.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createPlaygroundRestApp } from "@langwatch/model-provider-server";

import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session";

/** `/api/playground`, bound to one process. */
export function mountPlaygroundRest(options: {
  security: AppRestSecurity;
  session: ApiHandlerManagedSessionPort;
  modelProviders: () => ModelProviderService;
  executionProxyBaseUrl: string;
}): MountableRestApp {
  const { security, session } = options;
  return createPlaygroundRestApp<HandlerManagedSession>({
    security,
    ports: {
      resolveSession: (request) => session.resolve(request),
      probeProjectPermission: (person, projectId, permission) =>
        session.permitted({ session: person, projectId, permission }),
      modelProviders: options.modelProviders,
      executionProxyBaseUrl: options.executionProxyBaseUrl,
    },
  });
}
