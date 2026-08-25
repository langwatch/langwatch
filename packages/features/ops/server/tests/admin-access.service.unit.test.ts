import { describe, expect, it } from "vitest";
import { AdminAccessService } from "../src/services/admin-access.service";

describe("AdminAccessService", () => {
  it("normalizes the configured comma-separated allow-list", () => {
    expect(
      AdminAccessService.parseEmails(
        " Root@Langwatch.ai , ops@langwatch.ai,, second@Example.com ",
      ),
    ).toEqual([
      "root@langwatch.ai",
      "ops@langwatch.ai",
      "second@example.com",
    ]);
  });

  it("matches case-insensitively and rejects missing email", () => {
    const access = AdminAccessService.create({
      adminEmails: ["root@langwatch.ai"],
    });
    expect(access.isAdmin({ email: " Root@Langwatch.ai " })).toBe(true);
    expect(access.isAdmin({ email: null })).toBe(false);
  });
});
