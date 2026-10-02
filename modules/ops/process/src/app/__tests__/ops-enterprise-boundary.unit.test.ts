/**
 * @vitest-environment node
 * Operator views over enterprise subjects live in enterprise-ops (ARCHITECTURE.md section 3).
 */
import { describe, expect, it } from "vitest";

import { opsProcessModule } from "../../ops.module.ts";

describe("the core ops module", () => {
  /** @scenario "Core ops serves no operator view over an enterprise subject" */
  it("serves neither the license registry nor the self-hosted instance registry", () => {
    const namespaces = opsProcessModule.transports.map((transport) => transport.namespace);

    expect(namespaces).not.toContain("licenseRegistry");
    expect(namespaces).not.toContain("selfHostedInstances");
  });
});
