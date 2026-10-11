export const ISLANDS = [
  "controls",
  "ground",
  "context-menus",
  "copy",
  "tabs",
  "menus",
  "media",
  "toc",
  "disclosures",
  "search",
  "playground",
];

export function islandHead({ sources, build = "dev" }) {
  return `<meta name="docs-build" content="${build}">${ISLANDS.map((name) => `<meta name="docs-island-${name}" content="${sources[name]}">`).join("")}`;
}

export function pageData({ slug, operation }) {
  const json = JSON.stringify({ slug, operation }).replaceAll("<", "\\u003c");
  return `<script type="application/json" id="docs-page-data">${json}</script>`;
}

export const themeScript = `<script>try{var t=localStorage.getItem("theme");var d=t==="dark"||(!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.add(d?"dark":"light");document.documentElement.style.colorScheme=d?"dark":"light"}catch{}</script>`;
