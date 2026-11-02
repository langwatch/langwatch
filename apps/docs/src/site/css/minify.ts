import { transform } from "lightningcss";

/* Vite's own default build target, "baseline-widely-available", as Lightning CSS versions
   (major << 16). The client CSS Vite emits is minified for these same browsers. */
export const CSS_TARGETS = {
  chrome: 107 << 16,
  edge: 107 << 16,
  firefox: 104 << 16,
  safari: 16 << 16,
  ios_saf: 16 << 16,
};

/** Minified CSS: merged duplicates, and only the prefixes the supported browsers still need. */
export function minifyCss({ css }: { css: string }) {
  const result = transform({
    filename: "docs.css",
    code: new TextEncoder().encode(css),
    minify: true,
    targets: CSS_TARGETS,
  });
  return new TextDecoder().decode(result.code);
}
