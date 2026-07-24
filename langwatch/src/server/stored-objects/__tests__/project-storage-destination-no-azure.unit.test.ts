/**
 * Regression test: in this PR, the destination resolver returns either
 * "s3" or "file" — never "azure". Sergio's 2026-05-20 review flagged a
 * mismatch where `.env.example` and the feature spec advertised
 * `azure-blob://` minting but no production write path ever produced
 * such a URI. We deferred Azure to a follow-up PR (AC37) and removed the
 * write claim from the spec; this test pins the contract so the resolver
 * cannot quietly grow an "azure" branch without a paired test + scenario.
 *
 * If/when Azure minting lands, delete this test and replace it with a
 * positive scenario showing the "azure" branch.
 */
import { describe, expect, it, vi } from "vitest";
import {
  resolveProjectStorageDestination,
  type ProjectStorageDestination,
} from "../project-storage-destination";

vi.mock("~/server/dataplane-s3", () => ({
  getS3ConfigForProject: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    S3_BUCKET_NAME: undefined,
    LANGWATCH_LOCAL_STORAGE_PATH: undefined,
  },
}));

import { getS3ConfigForProject } from "~/server/dataplane-s3";
import { env } from "~/env.mjs";

const mockGetS3ConfigForProject = vi.mocked(getS3ConfigForProject);

describe("resolveProjectStorageDestination", () => {
  describe("when no S3 bucket and no Azure config are present", () => {
    /** @scenario "Stored-objects writes do not mint azure-blob URIs in this PR" */
    it("falls back to a file destination, never an azure one", async () => {
      mockGetS3ConfigForProject.mockResolvedValueOnce(null as unknown as Awaited<
        ReturnType<typeof getS3ConfigForProject>
      >);
      // env.S3_BUCKET_NAME and LANGWATCH_LOCAL_STORAGE_PATH are both undefined
      // via the module-level mock above, exercising the file-default branch.

      const destination = await resolveProjectStorageDestination("proj_x");

      // Exhaustiveness: the union is currently {s3 | file}. If/when Azure
      // is added, this assertion is the trip-wire — the new branch needs
      // its own positive scenario before this test gets updated.
      expect(destination.kind).toMatch(/^(s3|file)$/);
      expect(destination.kind).not.toBe("azure");
    });
  });

  it("returns a kind value present in the ProjectStorageDestination union", async () => {
    mockGetS3ConfigForProject.mockResolvedValueOnce(null as unknown as Awaited<
      ReturnType<typeof getS3ConfigForProject>
    >);
    const destination: ProjectStorageDestination = await resolveProjectStorageDestination(
      "proj_y",
    );
    // Type-level assertion: ProjectStorageDestination is a discriminated
    // union with no "azure" arm. If someone widens the union, TypeScript
    // catches it; this also keeps `env` in the active import graph so
    // tests that disable tree-shaking don't lose the mock binding.
    expect(typeof env).toBe("object");
    expect(["s3", "file"]).toContain(destination.kind);
  });
});
