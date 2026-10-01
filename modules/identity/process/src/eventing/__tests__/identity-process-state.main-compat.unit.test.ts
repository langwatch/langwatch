import { describe, expect, it } from "vitest";

import { breakGlassExpiryWarnStateSchema } from "../break-glass-expiry-warn.process.ts";
import { connectionTeardownStateSchema } from "../connection-teardown.process.ts";
import { joinRequestLifecycleStateSchema } from "../join-request-lifecycle.process.ts";
import { ssoDomainProofNotificationStateSchema } from "../sso-domain-proof-notification.process.ts";
import { ssoDomainReproofSweepStateSchema } from "../sso-domain-reproof-sweep.process.ts";

describe("process state stored by the main release", () => {
  it("parses a break-glass expiry warning state as main stored it", () => {
    expect(breakGlassExpiryWarnStateSchema.parse({ lastWarnAt: null })).toEqual({
      lastWarnAt: null,
    });
  });
  it("parses a connection teardown state as main stored it", () => {
    expect(connectionTeardownStateSchema.parse({ tearDownAfterMs: 1_760_000_000_000 })).toEqual({
      tearDownAfterMs: 1_760_000_000_000,
    });
  });
  it("parses a join request lifecycle state as main stored it", () => {
    expect(
      joinRequestLifecycleStateSchema.parse({
        remindAtMs: 1,
        expiresAtMs: 2,
        remindedAt: null,
        joinRequestId: "jr_1",
        organizationId: "org_1",
        requesterUserId: "user_1",
        domain: "example.com",
      }),
    ).toEqual({
      remindAtMs: 1,
      expiresAtMs: 2,
      remindedAt: null,
      joinRequestId: "jr_1",
      organizationId: "org_1",
      requesterUserId: "user_1",
      domain: "example.com",
    });
  });
  it("fills the identity fields a first-release join request state never stored", () => {
    expect(
      joinRequestLifecycleStateSchema.parse({ remindAtMs: 1, expiresAtMs: 2, remindedAt: null }),
    ).toEqual({
      remindAtMs: 1,
      expiresAtMs: 2,
      remindedAt: null,
      joinRequestId: null,
      organizationId: null,
      requesterUserId: null,
      domain: null,
    });
  });
  it("parses an SSO domain re-proof sweep state as main stored it", () => {
    expect(ssoDomainReproofSweepStateSchema.parse({ lastSweepAt: null })).toEqual({
      lastSweepAt: null,
    });
  });
  it("parses the empty SSO domain proof notification state main stored", () => {
    expect(ssoDomainProofNotificationStateSchema.parse({})).toEqual({});
  });
});
