import type { StaffAccessCopyItem } from "@langwatch/staff-access-contract";
import { describe, expect, it } from "vitest";

import {
  auditedPlan,
  COPY_SOURCE_SCOPES,
  COPY_TARGET_SCOPES,
  copyTotals,
  failureReason,
  holdsScopes,
  selectProjects,
} from "../staff-access-copy.rules.ts";

const item = (overrides: Partial<StaffAccessCopyItem>): StaffAccessCopyItem => ({
  kind: "prompt",
  name: "reply",
  sourceId: "prompt_1",
  sourceProjectId: "project_1",
  outcome: "planned",
  targetId: null,
  targetProjectId: null,
  reason: null,
  ...overrides,
});

describe("holdsScopes", () => {
  it("needs every scope of a side", () => {
    expect(holdsScopes({ scopes: ["ops:copy", "org:content"], needed: COPY_SOURCE_SCOPES })).toBe(
      true,
    );
    expect(holdsScopes({ scopes: ["ops:copy", "org:content"], needed: COPY_TARGET_SCOPES })).toBe(
      false,
    );
  });
});

describe("selectProjects", () => {
  const projects = [
    { id: "project_1", slug: "support-bot" },
    { id: "project_2", slug: "lab" },
  ];

  it("takes every project when none is named", () => {
    expect(selectProjects({ projects, named: undefined })).toEqual({
      selected: projects,
      unknown: [],
    });
  });

  it("matches by id or slug and reports the names it did not find", () => {
    expect(selectProjects({ projects, named: ["support-bot", "project_2", "gone"] })).toEqual({
      selected: projects,
      unknown: ["gone"],
    });
  });
});

describe("copyTotals and auditedPlan", () => {
  it("counts outcomes and lists only planned items for the audit row", () => {
    const items = [
      item({ kind: "project", name: "support-bot" }),
      item({}),
      item({ outcome: "skipped", reason: "unnamed_prompt" }),
    ];
    expect(copyTotals(items)).toEqual({
      planned: 2,
      copied: 0,
      already_copied: 0,
      skipped: 1,
      failed: 0,
    });
    expect(auditedPlan(items)).toEqual({
      counts: { project: 1, prompt: 1 },
      names: ["project: support-bot", "prompt: reply"],
    });
  });
});

describe("failureReason", () => {
  it("answers a handled code and hides anything else", () => {
    expect(failureReason({ code: "dataset_not_found" })).toBe("dataset_not_found");
    expect(failureReason(new Error("connection reset by 10.0.0.4"))).toBe("unexpected_error");
  });
});
