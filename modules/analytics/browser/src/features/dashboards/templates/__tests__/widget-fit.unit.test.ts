/**
 * A short card keeps its empty face usable: the stored code carries plain CSS height rules,
 * so the face drops its icon, then folds into one row, and its button never clips.
 */

import { describe, expect, it } from "vitest";

import { SETUP_NOTE } from "../../catalogue/widgets/setup-note.ts";
import {
  FACE_FULL_MIN_HEIGHT_PX,
  FACE_ICON_MIN_HEIGHT_PX,
  widgetCode,
} from "../model/widget-code-parts.ts";

const spec = {
  summary: "A test widget.",
  subtitle: "What the panel is for",
  source: "traces",
  parts: [],
  queries: ["main"],
  body: "  return <Panel><CallToAction /></Panel>;",
} as const;

const count = ({ text, part }: { text: string; part: string }) => text.split(part).length - 1;

describe("given a widget's stored code", () => {
  const { tsx } = widgetCode(spec);

  /** @scenario "AC114 Widget fit: the empty face fits a short card" */
  it("drops the icon below the icon height and folds into one row below the full height", () => {
    expect(FACE_ICON_MIN_HEIGHT_PX).toBe(220);
    expect(FACE_FULL_MIN_HEIGHT_PX).toBe(180);
    expect(tsx).toContain(".lw-icon { display: none !important; }");
    expect(tsx).toContain(`@media (max-height: ${FACE_ICON_MIN_HEIGHT_PX - 1}px)`);
    expect(tsx).toContain(`@media (max-height: ${FACE_FULL_MIN_HEIGHT_PX - 1}px)`);
    expect(tsx).toContain(".lw-full { display: none !important; }");
    expect(tsx).toContain(".lw-row { display: flex !important; }");
    expect(tsx).toContain('className="lw-full"');
    expect(tsx).toContain('className="lw-icon"');
    expect(tsx).toContain('className="lw-row"');
  });

  /** @scenario "AC114 Widget fit: the empty face fits a short card" */
  it("puts the setup button in both layouts and truncates the row's line", () => {
    expect(count({ text: tsx, part: 'LW.navigate("traces", {})' })).toBe(2);
    expect(tsx).toContain('whiteSpace: "nowrap"');
    expect(tsx).toContain("...CTA_CLIP");
  });

  /** @scenario "AC114 Widget fit: the empty face fits a short card" */
  it("keeps a strip's face one row at every height", () => {
    const strip = widgetCode({ ...spec, compactCallToAction: true }).tsx;

    expect(strip).not.toContain('className="lw-full"');
    expect(strip).not.toContain('className="lw-row"');
    expect(count({ text: strip, part: 'LW.navigate("traces", {})' })).toBe(1);
  });

  /** @scenario "AC114 Widget fit: the empty face fits a short card" */
  it("tightens a setup note's padding on a short frame", () => {
    expect(SETUP_NOTE).toContain('className="lw-setup"');
    expect(tsx).toContain(".lw-setup { padding: 8px 12px !important; }");
  });
});
