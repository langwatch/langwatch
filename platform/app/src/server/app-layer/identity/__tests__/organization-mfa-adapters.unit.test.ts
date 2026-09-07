import { beforeEach, describe, expect, it, vi } from "vitest";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info }),
}));

import { LoggingOrganizationMfaNotifier } from "../organization-mfa-adapters";

describe("LoggingOrganizationMfaNotifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** @scenario "Turning the requirement on is recorded with who did it" */
  it("records the actor and affected member count without claiming delivery", async () => {
    const notifier = new LoggingOrganizationMfaNotifier();

    await notifier.requirementTurnedOn({
      organizationId: "org-acme",
      actorUserId: "ana",
      memberUserIds: ["ana", "olga"],
    });

    expect(info).toHaveBeenCalledWith(
      { organizationId: "org-acme", actorUserId: "ana", memberCount: 2 },
      "organization now requires a second factor; no notification is sent yet",
    );
  });
});
