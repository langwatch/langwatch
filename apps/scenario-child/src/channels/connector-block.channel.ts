/**
 * How one Scenario Connector block's workflow reaches the code runner (ADR-194). The service
 * builds the workflow and reads the answer; the channel only posts it.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { ConnectorBlockKind, ConnectorObject } from "../rules/connector-block.rules.ts";

export interface ConnectorBlockChannel {
  /**
   * Posts one block's workflow, aborted at `timeoutMs`; answers the body as text.
   * @throws ConnectorBlockError when the runner answers non-2xx, times out or cannot be reached.
   */
  post(input: {
    kind: ConnectorBlockKind;
    workflow: Record<string, unknown>;
    input: ConnectorObject;
    timeoutMs: number;
  }): Promise<string>;
}
