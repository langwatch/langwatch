import { createHash } from "node:crypto";

export function extractStyles({ html }) {
  const styles = [];
  const body = html
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/g, (_, css) => {
      styles.push(css);
      return "";
    })
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const css = [...new Set(styles)].join("\n");
  const hash = createHash("sha256").update(css).digest("hex").slice(0, 16);
  return { html: body, css, rules: [...new Set(styles)], href: `/assets/page-${hash}.css` };
}
