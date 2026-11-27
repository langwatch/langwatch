import { STAFF_COPY_TARGET_PERMISSIONS } from "@langwatch/authz-contract";
import { DatasetNotReadyError } from "@langwatch/dataset-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { StaffAccessCopyItem } from "@langwatch/staff-access-contract";
import { describe, expect, it } from "vitest";

import {
  auditedPlan,
  COPY_SOURCE_SCOPES,
  COPY_TARGET_SCOPES,
  copyTotals,
  failureReason,
  holdsScopes,
  promptFields,
  refusedBeforeMaking,
  selectProjects,
  withinGrant,
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
  it("needs the scope of its own side", () => {
    expect(holdsScopes({ scopes: ["copy:source"], needed: COPY_SOURCE_SCOPES })).toBe(true);
    expect(holdsScopes({ scopes: ["copy:source"], needed: COPY_TARGET_SCOPES })).toBe(false);
    expect(holdsScopes({ scopes: ["org:support"], needed: COPY_TARGET_SCOPES })).toBe(false);
  });
});

describe("withinGrant", () => {
  /** @scenario "A copy makes only what the target approval granted" */
  it("allows a kind only when the grant holds every permission it needs", () => {
    expect(withinGrant({ kind: "project", grant: STAFF_COPY_TARGET_PERMISSIONS })).toBe(true);
    expect(withinGrant({ kind: "monitor", grant: STAFF_COPY_TARGET_PERMISSIONS })).toBe(true);
    expect(withinGrant({ kind: "monitor", grant: ["evaluations:create"] })).toBe(true);
    expect(withinGrant({ kind: "prompt", grant: ["prompts:create"] })).toBe(false);
    expect(withinGrant({ kind: "dataset", grant: ["project:create"] })).toBe(false);
    expect(withinGrant({ kind: "project", grant: [] })).toBe(false);
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
      stopped: 0,
    });
    expect(auditedPlan({ items })).toEqual({
      counts: { project: 1, prompt: 1 },
      names: ["project: support-bot", "prompt: reply"],
    });
  });

  /** @scenario "A stopped copy's audit rows name every target the run made" */
  it("lists copied items and failed items that hold a target, never earlier copies", () => {
    const items = [
      item({ kind: "project", name: "support-bot", outcome: "copied", targetId: "project_9" }),
      item({ kind: "dataset", name: "golden", outcome: "failed", targetId: "dataset_9" }),
      item({ kind: "evaluator", name: "judge", outcome: "failed" }),
      item({ outcome: "already_copied", targetId: "prompt_9" }),
      item({ outcome: "stopped", reason: "source_approval_ended" }),
    ];
    expect(auditedPlan({ items, select: "made" })).toEqual({
      counts: { project: 1, dataset: 1 },
      names: ["project: support-bot", "dataset: golden"],
    });
  });
});

describe("promptFields and dataset links", () => {
  const inline = { records: { question: ["2+2?"] }, columnTypes: [] };
  const linkedFields: Partial<VersionedPrompt> = {
    id: "prompt_1",
    prompt: "Answer",
    messages: [],
    inputs: [],
    outputs: [],
    model: "openai/gpt-5",
    demonstrations: { id: "dataset_acme_1", name: "ACME golden", inline },
    promptingTechnique: {
      type: "few_shot" as const,
      demonstrations: { id: "dataset_acme_2", name: "ACME shots" },
    },
  };
  const linked = linkedFields as VersionedPrompt;

  /** @scenario "A copied prompt never points at a dataset of the source organization" */
  it("keeps inline demonstration rows and drops every source dataset id and name", () => {
    const fields = promptFields(linked);

    expect(fields.demonstrations).toEqual({ inline });
    expect(fields.promptingTechnique).toEqual({ type: "few_shot" });
    expect(JSON.stringify(fields)).not.toMatch(/dataset_acme|ACME/);
  });
});

describe("refusedBeforeMaking", () => {
  /** @scenario "Only a handled refusal below 500 counts as refused before anything was made" */
  it("counts a handled error below 500 and nothing else", () => {
    expect(refusedBeforeMaking(new DatasetNotReadyError({ status: "processing" }))).toBe(true);
    expect(refusedBeforeMaking({ code: "copy_broke", httpStatus: 500 })).toBe(false);
    expect(refusedBeforeMaking(new Error("connection reset"))).toBe(false);
    expect(refusedBeforeMaking({ httpStatus: 404 })).toBe(false);
    expect(refusedBeforeMaking(null)).toBe(false);
  });
});

describe("promptFields", () => {
  const version = (settings: Partial<VersionedPrompt>): VersionedPrompt =>
    ({
      id: "prompt_1",
      prompt: "Answer politely",
      messages: [{ role: "system", content: "Answer politely" }],
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [{ identifier: "answer", type: "str" }],
      model: "openai/gpt-5",
      ...settings,
    }) as VersionedPrompt;

  const settings = {
    temperature: 0.2,
    maxTokens: 512,
    topP: 0.9,
    frequencyPenalty: 0.1,
    presencePenalty: 0.3,
    seed: 7,
    topK: 40,
    minP: 0.05,
    repetitionPenalty: 1.1,
    reasoning: "high",
    verbosity: "low",
    promptingTechnique: { type: "chain_of_thought" as const },
    demonstrations: { inline: { records: { question: ["2+2?"] }, columnTypes: [] } },
    responseFormat: { type: "json_schema" as const, json_schema: { name: "answer", schema: {} } },
  } satisfies Partial<VersionedPrompt>;

  /** @scenario "A copied prompt version carries every model setting it has and no other" */
  it("carries each setting a version has and leaves out the ones it has not", () => {
    const base = {
      prompt: "Answer politely",
      messages: [{ role: "system", content: "Answer politely" }],
      inputs: [{ identifier: "question", type: "str" }],
      outputs: [{ identifier: "answer", type: "str" }],
      model: "openai/gpt-5",
    };
    expect(promptFields(version(settings))).toEqual({ ...base, ...settings });
    expect(promptFields(version({ id: "prompt_2" }))).toEqual(base);
  });
});

describe("failureReason", () => {
  it("answers a handled code and hides anything else", () => {
    expect(failureReason({ code: "dataset_not_found" })).toBe("dataset_not_found");
    expect(failureReason(new Error("connection reset by 10.0.0.4"))).toBe("unexpected_error");
  });
});
