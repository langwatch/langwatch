import { describe, expect, it } from "vitest";
import { resolveDispatchAllowListRedisKey } from "../dispatch-scope";

function hashTag(key: string): string | undefined {
  return /\{([^}]+)\}/.exec(key)?.[1];
}

describe("dispatch scope Redis keys", () => {
  it("keeps unrestricted and restricted dispatch keys in the queue hash slot", () => {
    const keyPrefix = "{event-sourcing/jobs}:gq:";
    const queueKeys = [
      `${keyPrefix}ready`,
      `${keyPrefix}blocked`,
      `${keyPrefix}paused-jobs`,
      `${keyPrefix}stats:total-pending`,
    ];
    const unrestricted = resolveDispatchAllowListRedisKey({ keyPrefix });
    const restricted = resolveDispatchAllowListRedisKey({
      keyPrefix,
      allowedGroupsKey: `${keyPrefix}preflight:run-1:candidates`,
    });

    expect(unrestricted).not.toBe("");
    expect([...queueKeys, unrestricted, restricted].map(hashTag)).toEqual(
      Array(6).fill("event-sourcing/jobs"),
    );
  });
});
