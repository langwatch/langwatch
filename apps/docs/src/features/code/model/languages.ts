const NAMES: Record<string, string> = {
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  python: "Python",
  py: "Python",
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  js: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  jsonc: "JSON",
  yaml: "YAML",
  yml: "YAML",
  go: "Go",
  java: "Java",
  sql: "SQL",
  toml: "TOML",
  markdown: "Markdown",
  md: "Markdown",
  mermaid: "Mermaid",
  text: "Text",
  plaintext: "Text",
  txt: "Text",
  liquid: "Liquid",
  promql: "PromQL",
  csv: "CSV",
  diff: "Diff",
  ini: "INI",
};

export function languageName({ lang }: { lang: string }): string {
  return NAMES[lang.toLowerCase()] ?? (lang ? lang : "Text");
}

const SDK_LABELS = ["python", "javascript", "typescript", "go", "java"];
const PACKAGE_LABELS = ["pip", "uv", "npm", "yarn", "pnpm", "bun", "poetry", "conda"];

/** A preference group is inferred only when every tab label belongs to one recognised set. */
export function preferenceGroupFor({ labels }: { labels: string[] }): string | null {
  const lower = labels.map((label) => label.trim().toLowerCase());
  if (lower.length < 2) return null;
  const apiLabels = [...SDK_LABELS, "curl"];
  const onlyApiLabels = lower.every((label) => apiLabels.includes(label));
  if (lower.includes("curl") && onlyApiLabels) return "api-language";
  if (lower.every((label) => SDK_LABELS.includes(label))) return "sdk-language";
  if (lower.every((label) => PACKAGE_LABELS.includes(label))) return "package-manager";
  return null;
}

const EXTENSIONS: Record<string, string> = {
  python: "py",
  py: "py",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  go: "go",
  java: "java",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yml",
  sql: "sql",
  toml: "toml",
  markdown: "md",
  md: "md",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  zsh: "sh",
  shellscript: "sh",
  csv: "csv",
  ini: "ini",
};

export function codeFilename({ lang, title }: { lang: string; title: string }): string {
  if (title && /\.[a-z0-9]+$/i.test(title)) return title;
  const filename = `example.${EXTENSIONS[lang.toLowerCase()] ?? "txt"}`;
  const languageLabel = languageName({ lang }).toLowerCase();
  if (!title || title.toLowerCase() === languageLabel) return filename;
  return `${title} · ${filename}`;
}
