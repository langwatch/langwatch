/**
 * The Experiments family, as this application composes it.
 *
 * The list, the workbench, the legacy result view and the retired wizard's
 * forward live in `@langwatch/experiment-web`; what belongs to the application
 * is everything they are not allowed to own — which page key each address
 * answers, the permission policy in front of the list, and which host is
 * mounted above them.
 *
 * NO API BINDING OF ITS OWN, and that absence is the design: every read this
 * family makes goes through `@langwatch/workflow-web/studio-host/api`, which is
 * the workflow family's client and is already installed. Adding a second
 * binding for the same procedures would mount a second tRPC client over the
 * same cache keys, which is exactly what the shared-cache rule exists to avoid.
 */

import { experimentPageLoaders } from "./ui/sections/experiment-routes";

export { experimentPageLoaders };
