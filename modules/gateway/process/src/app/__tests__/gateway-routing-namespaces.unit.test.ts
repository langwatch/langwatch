/**
 * @vitest-environment node
 * Routing policies and personal keys are Enterprise subjects (ARCHITECTURE.md section 3).
 */
import { describe, expect, it } from "vitest";

import { gatewayServer } from "../../gateway.server.ts";

describe("the core gateway module", () => {
  /** @scenario "Core gateway serves neither routing policies nor personal virtual keys" */
  it("serves neither routingPolicy nor personalVirtualKeys", () => {
    const namespaces = gatewayServer.transports.map((transport) => transport.namespace);

    expect(namespaces).not.toContain("routingPolicy");
    expect(namespaces).not.toContain("personalVirtualKeys");
  });
});
