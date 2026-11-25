import { afterAll, describe, expect, it } from "vitest";

import { noRawFontSizeRule } from "../../src/rules/no-raw-font-size.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

const BROWSER = "modules/agent/browser/src/ui/elements/row.tsx";

function report(filename, code) {
  return runRule(noRawFontSizeRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, messageId }) => ({ messageId, prop: data.prop, value: data.value }),
  );
}

describe("given browser code", () => {
  describe("when a JSX prop sizes text in px, em, rem or a bare number", () => {
    /** @scenario "A raw font size on a JSX prop is reported" */
    it("reports rawFontSize naming the prop and the value", () => {
      const code = [
        'const a = <Text fontSize="13px" />;',
        'const b = <Text fontSize="0.875em" />;',
        "const c = <Text fontSize={12} />;",
        'const d = <Text textStyle="11.5px" />;',
        'const e = <Text fontSize={hero ? "16px" : "15px"} />;',
        'const f = <Text fontSize={{ base: "12px", md: "1rem" }} />;',
      ].join("\n");

      expect(report(BROWSER, code)).toEqual([
        { messageId: "rawFontSize", prop: "fontSize", value: "13px" },
        { messageId: "rawFontSize", prop: "fontSize", value: "0.875em" },
        { messageId: "rawFontSize", prop: "fontSize", value: "12" },
        { messageId: "rawFontSize", prop: "textStyle", value: "11.5px" },
        { messageId: "rawFontSize", prop: "fontSize", value: "16px" },
        { messageId: "rawFontSize", prop: "fontSize", value: "15px" },
        { messageId: "rawFontSize", prop: "fontSize", value: "12px" },
        { messageId: "rawFontSize", prop: "fontSize", value: "1rem" },
      ]);
    });
  });

  describe("when a style object sizes text in px or a bare number", () => {
    /** @scenario "A raw font size in a style object is reported" */
    it("reports rawFontSize for the property", () => {
      const code = [
        'const css = { "& pre": { fontSize: "12px" } };',
        "const tick = { fill: axis, fontSize: 11 };",
      ].join("\n");

      expect(report(BROWSER, code)).toEqual([
        { messageId: "rawFontSize", prop: "fontSize", value: "12px" },
        { messageId: "rawFontSize", prop: "fontSize", value: "11" },
      ]);
    });
  });

  describe("when the size comes from the scale", () => {
    /** @scenario "A text style or a size token is accepted" */
    it("reports nothing", () => {
      const code = [
        'const a = <Text textStyle="bodySm" />;',
        'const b = <Text fontSize="sm" />;',
        "const c = <Text fontSize={size} />;",
        'const d = { textStyle: "caption", fontSize: "inherit" };',
        "const e = { fontSize: TYPE_SCALE_PX.micro };",
        'const f = <Box width="12px" lineHeight="16px" />;',
      ].join("\n");

      expect(report(BROWSER, code)).toEqual([]);
    });
  });

  describe("when the file is not module browser code", () => {
    it("is left alone", () => {
      const code = 'const a = <Text fontSize="13px" />;';

      expect(report("modules/agent/process/src/services/s.tsx", code)).toEqual([]);
      expect(report("modules/agent/browser/src/__tests__/row.unit.test.tsx", code)).toEqual([]);
    });
  });
});
