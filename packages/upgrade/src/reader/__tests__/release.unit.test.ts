/**
 * @see specs/upgrade/upgrade-reader.feature
 */
import { describe, expect, it } from "vitest";

import { compareReleases, compareReleasesNewestFirst, pickHighestRelease } from "../release.ts";

describe("compareReleases", () => {
  /** @scenario "Releases are compared by version and an unversioned build is never ordered" */
  it("orders versions numerically, so 3.10.0 is newer than 3.9.0", () => {
    expect(compareReleases({ left: "3.10.0", right: "3.9.0" })).toBe("newer");
    expect(compareReleases({ left: "3.9.0", right: "3.10.0" })).toBe("older");
  });

  /** @scenario "Releases are compared by version and an unversioned build is never ordered" */
  it("ranks a release above its own prerelease", () => {
    expect(compareReleases({ left: "3.10.0", right: "3.10.0-rc.1" })).toBe("newer");
    expect(compareReleases({ left: "3.10.0-rc.2", right: "3.10.0-rc.10" })).toBe("older");
  });

  /** @scenario "Releases are compared by version and an unversioned build is never ordered" */
  it("treats a leading v as the same release", () => {
    expect(compareReleases({ left: "v3.10.0", right: "3.10.0" })).toBe("same");
  });

  /** @scenario "Releases are compared by version and an unversioned build is never ordered" */
  it("never orders an unversioned build against a version or another build", () => {
    expect(compareReleases({ left: "git-1a2b3c4", right: "3.10.0" })).toBe("unknown");
    expect(compareReleases({ left: "git-1a2b3c4", right: "git-9f8e7d6" })).toBe("unknown");
    expect(compareReleases({ left: "git-1a2b3c4", right: "git-1a2b3c4" })).toBe("same");
  });

  it("picks the highest orderable release and ignores unversioned ones", () => {
    expect(
      pickHighestRelease({ releases: ["3.9.0", "git-1a2b3c4", "3.10.0", "3.10.0-rc.1"] }),
    ).toBe("3.10.0");
    expect(pickHighestRelease({ releases: ["git-1a2b3c4"] })).toBeNull();
  });

  it("sorts newest first with an unreleased group last", () => {
    const sorted = ["3.9.0", null, "3.10.0", "git-1a2b3c4"].toSorted((left, right) =>
      compareReleasesNewestFirst({ left, right }),
    );
    expect(sorted).toEqual(["3.10.0", "3.9.0", "git-1a2b3c4", null]);
  });
});
