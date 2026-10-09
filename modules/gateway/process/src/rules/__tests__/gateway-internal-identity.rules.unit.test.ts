import { describe, expect, it } from "vitest";

import { canonicalGatewayPath } from "../gateway-internal-identity.rules.ts";

describe("the signed path line", () => {
  // The Go signer's TestCanonicalPathSortsAndEncodesTheQuery asserts the same vector.
  it("sorts and RFC 3986-encodes the query exactly as the Go gateway does", () => {
    const url = new URL(
      "http://api.test/api/internal/gateway/budget-bucket-spend?end_user_id=a%20b%2Bc~*!&budget_id=x%2Fy&a=2&a=1&n=%C3%A9&flag",
    );

    expect(canonicalGatewayPath(url)).toBe(
      "/api/internal/gateway/budget-bucket-spend?a=1&a=2&budget_id=x%2Fy&end_user_id=a%20b%2Bc~%2A%21&flag=&n=%C3%A9",
    );
  });

  it("is the bare path when there is no query", () => {
    expect(canonicalGatewayPath(new URL("http://api.test/api/internal/gateway/health?"))).toBe(
      "/api/internal/gateway/health",
    );
  });
});
