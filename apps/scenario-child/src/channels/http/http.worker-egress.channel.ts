/**
 * The scenario child's own outbound HTTP: every request an HTTP target or its hooks make goes
 * through here, behind the SSRF fence.
 * @see specs/scenarios/child-execution-contract.feature
 */

import { fetchValidatedDestination } from "@langwatch/egress/ssrf/fenced-fetch";
import { createSsrfUrlValidator } from "@langwatch/egress/ssrf/url-validator";
import { decodeScenarioEgressPolicy } from "@langwatch/scenario-contract";

import type { ScenarioChildEnvironment } from "../../config.ts";
import type { ScenarioHttp, ScenarioHttpResponse } from "./http.serialized-http-agent.channel.ts";

/**
 * The one egress the run makes on its own account. An HTTP target is a URL the customer typed,
 * dialled from inside the cluster, so it goes through the same metadata-and-redirect fence every
 * other outbound request in the product does rather than through native `fetch`.
 */
export class WorkerScenarioChildHttp implements ScenarioHttp {
  private readonly validate: ReturnType<typeof createSsrfUrlValidator>;
  private readonly rejectUnauthorized: boolean;

  constructor(environment: Pick<ScenarioChildEnvironment, "egressPolicy" | "rejectUnauthorized">) {
    this.validate = createSsrfUrlValidator(decodeScenarioEgressPolicy(environment.egressPolicy));
    this.rejectUnauthorized = environment.rejectUnauthorized;
  }

  /**
   * `init.signal` is passed through to every hop: a hook's budget ends the request, so a hook that
   * never answers stops at its timeout and not at undici's 300 s default.
   */
  async fetch(input: Parameters<ScenarioHttp["fetch"]>[0]): Promise<ScenarioHttpResponse> {
    const validated = await this.validate(input.url);
    return fetchValidatedDestination(validated, input.init, {
      rejectUnauthorized: this.rejectUnauthorized,
    });
  }
}
