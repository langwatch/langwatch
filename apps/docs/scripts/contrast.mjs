import { chromium } from "playwright";

const browser = await chromium.launch();
const base = process.env.DOCS_URL ?? "http://localhost:4173";

try {
  for (const mode of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme: mode });
    await context.addInitScript(({ mode }) => localStorage.setItem("theme", mode), { mode });
    const page = await context.newPage();
    await page.goto(`${base}/integration/quick-start/`);
    await page.locator(".docs-prose").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const results = await page.evaluate(() => {
      const swatch = document.createElement("span");
      document.body.append(swatch);
      function resolve({ token }) {
        swatch.style.color = `var(--chakra-colors-${token})`;
        return getComputedStyle(swatch).color;
      }
      function luminance({ colour }) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        context.fillStyle = colour;
        context.fillRect(0, 0, 1, 1);
        const channels = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      }
      function pair({ label, foreground, background, minimum = 4.5 }) {
        const fg = resolve({ token: foreground });
        const bg = resolve({ token: background });
        const a = luminance({ colour: fg });
        const b = luminance({ colour: bg });
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        return {
          label,
          foreground: fg,
          background: bg,
          ratio: Number(ratio.toFixed(2)),
          pass: ratio >= minimum,
        };
      }
      const results = [
        pair({ label: "Body on paper", foreground: "nav-fg", background: "bg-surface" }),
        pair({ label: "Sidebar on canvas", foreground: "nav-fg", background: "docs-canvas" }),
        pair({ label: "Muted text", foreground: "fg-muted", background: "bg-surface" }),
        pair({ label: "Links and headings", foreground: "fg", background: "bg-surface" }),
        pair({ label: "Selected sidebar", foreground: "accent-fg", background: "accent-subtle" }),
        pair({
          label: "Orange labels / tab indicator",
          foreground: "accent-fg",
          background: "bg-subtle",
        }),
        pair({
          label: "Input boundary",
          foreground: "docs-control-border",
          background: "bg-surface",
          minimum: 3,
        }),
        pair({ label: "Tip", foreground: "green-fg", background: "green-subtle" }),
        pair({
          label: "Banner and active icon",
          foreground: "accent-on-solid",
          background: "docs-primary",
        }),
      ];
      const background = luminance({ colour: resolve({ token: "bg-nested" }) });
      const syntax = [...document.querySelectorAll(".docs-code .docs-line span")].map((span) => {
        const foreground = luminance({ colour: getComputedStyle(span).color });
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      });
      if (syntax.length) {
        const ratio = Math.min(...syntax);
        results.push({
          label: "Minimum syntax contrast",
          ratio: Number(ratio.toFixed(2)),
          pass: ratio >= 4.5,
        });
      }
      swatch.remove();
      return { fonts: document.fonts.check("16px Inter"), results };
    });
    console.log(JSON.stringify({ mode, ...results }, null, 2));
    if (!results.fonts || results.results.some((result) => !result.pass)) process.exitCode = 1;
    await context.close();
  }
} finally {
  await browser.close();
}
