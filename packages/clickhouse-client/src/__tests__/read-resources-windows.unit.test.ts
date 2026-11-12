import {
  AUTHORIZATION_CONDITION_TYPES,
  BRAID_CONDITION_EVERY_SPAN,
  honourSpanBraids,
  PROOF_BEARING_PERMISSIONS,
  sealAuthorization,
  SPAN_BRAID_PERMISSION,
} from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { fenceFor, READ_RESOURCES, type ReadResource } from "../authorized-reads.ts";

/**
 * A braid grant carries `spans:braided` alone, and only `spans` applies `span` windows, so a
 * braid reaches no other read even where the reader holds every proof-bearing permission. Each
 * resource names every condition type; these guards hold both choices (ADR-201 §3).
 */

const resources = Object.entries(READ_RESOURCES) as [
  ReadResource,
  (typeof READ_RESOURCES)[ReadResource],
][];

const OWNER_REVIEW =
  "A read resource that applies `span` windows shows braided spans from other projects. " +
  "Read ADR-201 §3 (dev/docs/adr/201-braids-show-matching-spans-in-another-projects-traces.md) " +
  "and have the braids owner review the change before updating this list.";

describe("the read resources the fence knows", () => {
  describe("when the resources applying a braid's span windows are listed", () => {
    /** @scenario "Only span reads take a braid's windows, and every read names each window type" */
    it("is exactly spans", () => {
      const applying = resources
        .filter(([, resource]) => resource.windows.span === "applies")
        .map(([name]) => name);

      expect(applying, OWNER_REVIEW).toEqual(["spans"]);
    });
  });

  describe("when each resource's windows are read", () => {
    /** @scenario "Only span reads take a braid's windows, and every read names each window type" */
    it("names every condition type, with no default", () => {
      for (const [name, resource] of resources) {
        expect(
          { name, types: Object.keys(resource.windows).toSorted() },
          `${name} must name how it treats every condition type`,
        ).toEqual({ name, types: [...AUTHORIZATION_CONDITION_TYPES].toSorted() });
      }
    });

    it("applies no log window, which no fence renders yet", () => {
      const applying = resources
        .filter(([, resource]) => resource.windows.log === "applies")
        .map(([name]) => name);

      expect(applying, "the fence renders no log window; add one before a read applies it").toEqual(
        [],
      );
    });
  });
});

describe("a braid grant across every read resource", () => {
  const READER = "proj_reader";
  const OWNER = "proj_owner";
  const proofWith = (braidPermissions: string[]) =>
    honourSpanBraids({
      authorization: sealAuthorization({
        actor: { type: "user", id: "ana" },
        principal: { type: "user", id: "ana" },
        scope: { organizationId: "org_acme" },
        grants: [
          { projectId: READER, permissions: [...PROOF_BEARING_PERMISSIONS], via: [], kind: "own" },
          {
            projectId: OWNER,
            permissions: braidPermissions,
            via: ["grant_braid"],
            kind: "shared",
            condition: {
              type: "span",
              compiledWhere: BRAID_CONDITION_EVERY_SPAN,
              from: 0,
              until: null,
            },
          },
        ],
        expiresAt: Date.now() + 30_000,
        purpose: { kind: "route", route: "traces.get" },
      }),
    });

  /** @scenario "Across every read resource, a braid grant reaches only the span read" */
  it("reaches the span read and no other, whichever permissions the reader holds", () => {
    const authorization = proofWith([SPAN_BRAID_PERMISSION]);
    const reaching = resources
      .map(([name]) => name)
      .filter((reads) => {
        const fence = fenceFor({ authorization, reads });
        const named = [...fence.own, ...fence.shared.map((window) => window.projectId)];
        return fence.braids !== undefined || named.includes(OWNER);
      });

    expect(reaching, OWNER_REVIEW).toEqual(["spans"]);
  });

  /** @scenario "Across every read resource, a braid grant reaches only the span read" */
  it("is refused when sealed carrying a read's own permission instead", () => {
    for (const permission of PROOF_BEARING_PERMISSIONS) {
      expect(() => proofWith([permission]), permission).toThrow(/spans:braided alone/);
    }
  });
});
