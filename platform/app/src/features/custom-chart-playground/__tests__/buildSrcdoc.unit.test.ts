import { describe, expect, it } from "vitest";

import { buildShimScript } from "../bridge/shimSource";
import { buildSrcdoc, escapeAuthorHtml } from "../buildSrcdoc";

describe("escapeAuthorHtml", () => {
  it("leaves plain author HTML untouched", () => {
    const html = "<div>hello</div><script>console.log(1)</script>";
    expect(escapeAuthorHtml(html)).toBe(html);
  });

  it("leaves a balanced nested template untouched", () => {
    const html = "<template><span>inner</span></template>";
    expect(escapeAuthorHtml(html)).toBe(html);
  });

  it("neutralises a stray closing template tag", () => {
    expect(escapeAuthorHtml("</template><b>escaped!</b>")).toBe(
      "&lt;/template><b>escaped!</b>",
    );
  });

  it("neutralises the unbalanced closer but keeps the balanced pair", () => {
    expect(escapeAuthorHtml("<template></template></template>")).toBe(
      "<template></template>&lt;/template>",
    );
  });

  it('leaves a literal "</template>" inside script raw text untouched', () => {
    const html = '<script>var s = "</template>";</script>';
    expect(escapeAuthorHtml(html)).toBe(html);
  });

  it("is case-insensitive about the stray closer", () => {
    expect(escapeAuthorHtml("</TEMPLATE>")).toBe("&lt;/TEMPLATE>");
  });
});

describe("buildSrcdoc", () => {
  it("embeds the author HTML inside the inert template", () => {
    const doc = buildSrcdoc("<div id='mine'>chart</div>");
    expect(doc).toContain(
      "<template id=\"lw-author\"><div id='mine'>chart</div></template>",
    );
  });

  it("executes only the shim directly: exactly one script before the template", () => {
    const doc = buildSrcdoc("<script>authorCode()</script>");
    const templateAt = doc.indexOf('<template id="lw-author">');
    const beforeTemplate = doc.slice(0, templateAt);
    expect(beforeTemplate.match(/<script>/g)).toHaveLength(1);
    // The author's script sits inside the template, after the shim.
    expect(doc.indexOf("authorCode()")).toBeGreaterThan(templateAt);
  });

  it("starts with a doctype", () => {
    expect(buildSrcdoc("x").startsWith("<!doctype html>")).toBe(true);
  });
});

describe("buildShimScript", () => {
  const shim = buildShimScript();

  it("never contains a script-terminating sequence (it is inlined in a <script>)", () => {
    expect(shim.toLowerCase()).not.toContain("</script");
  });

  it("speaks every protocol message the frame sends", () => {
    for (const type of [
      "lw:query",
      "lw:set-height",
      "lw:log",
      "lw:error",
      "lw:heartbeat",
    ]) {
      expect(shim).toContain(type);
    }
  });

  it("handles every protocol message the parent sends", () => {
    for (const type of [
      "lw:init",
      "lw:query-result",
      "lw:query-error",
      "lw:params-change",
    ]) {
      expect(shim).toContain(type);
    }
  });

  it("clamps setHeight to the shared 60-640 bounds", () => {
    expect(shim).toContain("Math.max(60, Math.min(640,");
  });

  it("activates the author template only inside the init handler", () => {
    const initAt = shim.indexOf('data.type !== "lw:init"');
    const activateCallAt = shim.lastIndexOf("activateAuthorTemplate()");
    expect(initAt).toBeGreaterThan(-1);
    expect(activateCallAt).toBeGreaterThan(initAt);
  });
});
