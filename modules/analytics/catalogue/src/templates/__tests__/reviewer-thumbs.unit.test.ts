/**
 * The annotations table holds thumbs from people reviewing traces in LangWatch,
 * not feedback from the agent's users. Widgets that read it say so.
 */

import { describe, expect, it } from "vitest";

import { IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../../catalogue/index.ts";
import { CALLS_TO_ACTION } from "../model/widget-calls-to-action.ts";

const READS_ANNOTATIONS = IMPLEMENTED_WIDGET_IDS.flatMap(
  (id) => implementedWidget(id) ?? [],
).filter(
  ({ key, definition }) =>
    key !== "fd-feedback" &&
    definition.queries.some(({ name, sql }) => name !== "present" && /FROM annotations/.test(sql)),
);

describe("given the template widgets that read reviewer thumbs", () => {
  /** @scenario "AC14 Reviewer thumbs are named as reviewer thumbs" */
  it("finds the thumbs-down widget among them", () => {
    expect(READS_ANNOTATIONS.map(({ key }) => key)).toContain("thumbs-down");
  });

  /** @scenario "AC14 Reviewer thumbs are named as reviewer thumbs" */
  it("names the thumbs as coming from reviewers, never from users", () => {
    const thumbsDown = READS_ANNOTATIONS.find(({ key }) => key === "thumbs-down");
    expect(thumbsDown?.name).toMatch(/reviewers/);
    expect(thumbsDown?.definition.code).toContain("reviewing traces in LangWatch");
    expect(thumbsDown?.definition.code).not.toMatch(/users (gave|rejected)/);
  });

  /** @scenario "AC14 Reviewer thumbs are named as reviewer thumbs" */
  it("keeps the feedback setup step from calling reviewer thumbs feedback from users", () => {
    expect(CALLS_TO_ACTION.feedback.line).toContain("reviewing traces in LangWatch");
    expect(CALLS_TO_ACTION.feedback.line).not.toMatch(/your users/);
  });
});
