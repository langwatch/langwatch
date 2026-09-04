/**
 * The optimization studio's outbound dispatch, composed as its own feature.
 *
 * `httpProxy.*` — the studio's event dispatch to the execution engine and the
 * agent test's own trace write. Both reach OUTSIDE this process, which is why
 * the capability arrives as a port: no core package owns the engine's address
 * or the credential a dispatch travels under.
 *
 * It used to be composed inside the observability half, so a deployment
 * missing the trace read stack lost the studio with it.
 */
import type { HttpProxyTrpcPorts } from "@langwatch/agent-server";
import { HandledError } from "@langwatch/handled-error";
import type { Logger } from "@langwatch/observability";

import type { ApiTrpcFeatureMount } from "../../api.application";
import { createHttpProxyTrpcRouter } from "./http-proxy-trpc.mount";

/** The studio's outbound event dispatch and the agent test's own trace write. */
export abstract class ApiStudioHostPort {
  abstract ports(): HttpProxyTrpcPorts;
}

/** Reports the one capability this feature can be composed without. */
export abstract class ApiStudioAbsenceReport {
  abstract absent(capability: "studio"): void;
}

/** Writes the absence to the process log, once, at composition time. */
export class LoggedApiStudioAbsence extends ApiStudioAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiStudioAbsence {
    return new LoggedApiStudioAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "studio"): void {
    this.logger.warn(
      { capability },
      "API process composed no studio host: the optimization studio's outbound event and the agent test's own trace write both refuse.",
    );
  }
}

/** The one namespace, built over the composed host. */
export type ComposedHttpProxyFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createHttpProxyTrpcRouter>;
}>;

/** Composes the studio dispatch over the host this process was given. */
export function composeHttpProxyFeature(options: {
  studio?: ApiStudioHostPort;
  report?: ApiStudioAbsenceReport;
}): ComposedHttpProxyFeature {
  if (!options.studio) options.report?.absent("studio");
  const ports = options.studio?.ports() ?? refusingPorts();

  return { router: (mount) => createHttpProxyTrpcRouter({ ...mount, ports }) };
}

/**
 * The studio dispatch on a process that composed no host.
 *
 * The namespace still mounts and every call refuses by name, so the studio
 * reports that this deployment runs no engine rather than appearing to
 * dispatch an event nothing receives.
 */
export function refusingHttpProxyFeature(): ComposedHttpProxyFeature {
  return { router: (mount) => createHttpProxyTrpcRouter({ ...mount, ports: refusingPorts() }) };
}

function refusingPorts(): HttpProxyTrpcPorts {
  return new Proxy(
    {},
    {
      get:
        () =>
        (): never => {
          throw new ApiStudioUnavailableError("The studio event dispatch");
        },
      has: () => true,
    },
  ) as HttpProxyTrpcPorts;
}

/** A capability this deployment did not compose, refused by name. */
class ApiStudioUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiStudioUnavailableError";
  }
}
