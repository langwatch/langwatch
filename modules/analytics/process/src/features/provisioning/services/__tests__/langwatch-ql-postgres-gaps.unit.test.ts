import { describe, expect, it } from "vitest";

import type { LwqlScopedViewState } from "../../../../repositories/langwatch-ql-postgres.repository.ts";
import { LangWatchQLPostgresGapsService } from "../langwatch-ql-postgres-gaps.service.ts";
import { LangWatchQLSelfProvisioningService } from "../langwatch-ql-self-provisioning.service.ts";

const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const postgresGaps = LangWatchQLPostgresGapsService.create();

describe("given what the reconvergence check finds in PostgreSQL", () => {
  const views = selfProvisioning.approvedPostgresViews();
  const found = views.map((view) => ({ view, granted: true }));
  const noGroup: LwqlScopedViewState = {
    groupExists: false,
    scopedSchema: "absent",
    groupOnShared: [],
    copies: [],
  };
  const readable = views.map((view) => ({ view, exists: true, passesGuard: true, granted: true }));

  /** @scenario "The reconvergence check skips the PostgreSQL half when the reader role and approved views are in place" */
  it("finds no gap when every approved view exists and the reader may select it", () => {
    expect(postgresGaps.findGaps({ found, scoped: noGroup })).toEqual([]);
  });

  /** @scenario "The reconvergence check converges the app-owned LangWatchQL objects it finds missing" */
  it("names a missing view as absent and an ungranted one as present", () => {
    const [missing, ungranted] = views;
    if (!missing || !ungranted) throw new Error("the catalog maps too few datasets");
    const gapped = found
      .filter((view) => view.view !== missing)
      .map((view) => (view.view === ungranted ? { ...view, granted: false } : view));

    expect(postgresGaps.findGaps({ found: gapped, scoped: noGroup })).toEqual([
      { kind: "shared", view: missing, absent: true },
      { kind: "shared", view: ungranted, absent: false },
    ]);
  });

  /** @scenario "Scoped copies exist only where the scoped-reader group does" */
  it("reports no scoped gap without the group, whatever the copies", () => {
    const copies = readable.map((copy) => ({ ...copy, exists: false }));

    expect(postgresGaps.findGaps({ found, scoped: { ...noGroup, copies } })).toEqual([]);
  });

  /** @scenario "Scoped copies exist only where the scoped-reader group does" */
  it("reports the scoped schema absent once the group exists", () => {
    expect(postgresGaps.findGaps({ found, scoped: { ...noGroup, groupExists: true } })).toEqual([
      { kind: "scoped-schema-absent" },
    ]);
  });

  /** @scenario "The reconvergence check guards every scoped copy" */
  it("names the group's shared grant, and each copy absent, unscoped or ungranted", () => {
    const [onShared, absent, unscoped, ungranted] = views;
    if (!onShared || !absent || !unscoped || !ungranted) {
      throw new Error("the catalog maps too few datasets");
    }
    const copies = readable.map((copy) => {
      if (copy.view === absent) return { ...copy, exists: false, passesGuard: false };
      if (copy.view === unscoped) return { ...copy, passesGuard: false };
      if (copy.view === ungranted) return { ...copy, granted: false };
      return copy;
    });
    const scoped: LwqlScopedViewState = {
      groupExists: true,
      scopedSchema: "owned",
      groupOnShared: [onShared],
      copies,
    };
    const gaps = postgresGaps.findGaps({ found, scoped });

    expect(gaps).toEqual([
      { kind: "group-on-shared", view: onShared },
      { kind: "scoped", view: absent, repair: "absent" },
      { kind: "scoped", view: unscoped, repair: "unscoped" },
      { kind: "scoped", view: ungranted, repair: "ungranted" },
    ]);
    expect(postgresGaps.scopedCopiesToRebuild({ gaps })).toEqual([absent, unscoped]);
  });

  /** @scenario "A scoped schema marked as another installation's is left alone" */
  it("names no copy in a scoped schema another installation owns", () => {
    const scoped: LwqlScopedViewState = {
      groupExists: true,
      scopedSchema: "foreign",
      groupOnShared: [],
      copies: readable.map((copy) => ({ ...copy, passesGuard: false })),
    };

    expect(postgresGaps.findGaps({ found, scoped })).toEqual([]);
  });

  it("rebuilds every copy once the scoped schema was found absent", () => {
    expect(
      postgresGaps.scopedCopiesToRebuild({ gaps: [{ kind: "scoped-schema-absent" }] }),
    ).toEqual(views);
  });
});
