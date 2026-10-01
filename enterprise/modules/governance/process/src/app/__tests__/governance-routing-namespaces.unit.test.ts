// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Routing policies and personal keys are the enterprise gateway's (ARCHITECTURE.md section 3).
 */
import { describe, expect, it } from "vitest";

import { governanceServer } from "../../governance.server.ts";

describe("the governance module", () => {
  /** @scenario "Governance serves neither routing policies nor personal virtual keys" */
  it("serves neither routingPolicy nor personalVirtualKeys", () => {
    const namespaces = governanceServer.transports.map((transport) => transport.namespace);

    expect(namespaces).not.toContain("routingPolicy");
    expect(namespaces).not.toContain("personalVirtualKeys");
  });
});
