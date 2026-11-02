/**
 * How one Connector step's workflow reaches the code runner (ADR-194). The service builds the
 * workflow and reads the answer; the channel only posts it.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { ConnectorHookKind, ConnectorObject } from "../rules/connector-step.rules.ts";

export interface ConnectorHookChannel {
  /**
   * Posts one step's workflow, aborted at `timeoutMs`; answers the body as text.
   * @throws ConnectorStepError when the runner answers non-2xx, times out or cannot be reached.
   */
  post(input: {
    kind: ConnectorHookKind;
    workflow: Record<string, unknown>;
    input: ConnectorObject;
    timeoutMs: number;
  }): Promise<string>;
}
