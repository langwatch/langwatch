import fs from "fs";
import path from "path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";
import type { Root, RootContent } from "mdast";

export interface InlineOptions {
  // When provided, partials referenced more than once collapse to a stub on
  // subsequent references. Used by the prompt compiler to dedup shared
  // sections across multi-skill compositions (e.g. `level-up`). Sync passes
  // `undefined` so each published file is fully self-contained.
  seenShared?: Set<string>;
  // Strip top-level frontmatter from output. Defaults to false (preserve).
  // Partials are always frontmatter-stripped when spliced in.
  stripFrontmatter?: boolean;
}

const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkMdx);

const stringifier = unified()
  .use(remarkStringify, { bullet: "-", fences: true, rule: "-" })
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkMdx);

interface EsmNode {
  value: string;
  data?: {
    estree?: {
      body?: Array<{
        type: string;
        specifiers?: Array<{ type: string; local?: { name?: string } }>;
        source?: { value?: string };
      }>;
    };
  };
}

function parseImports(node: EsmNode): { name: string; source: string }[] {
  // remark-mdx attaches a parsed estree under `data` — use it instead of regex
  // so we get bulletproof handling of multi-line / multi-statement import blocks.
  const body = node.data?.estree?.body ?? [];
  const out: { name: string; source: string }[] = [];
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration") {
      throw new Error(
        `Only \`import Name from './path.mdx'\` statements are supported. Got: ${stmt.type}`
      );
    }
    const def = stmt.specifiers?.find((s) => s.type === "ImportDefaultSpecifier");
    if (!def?.local?.name || !stmt.source?.value) {
      throw new Error(
        `Default import expected: \`import Name from './path.mdx'\``
      );
    }
    out.push({ name: def.local.name, source: stmt.source.value });
  }
  return out;
}

function parseFile(filePath: string): Root {
  const raw = fs.readFileSync(filePath, "utf8");
  return parser.parse(raw) as Root;
}

function inlineTree(filePath: string, opts: InlineOptions, stack: string[]): Root {
  if (stack.includes(filePath)) {
    throw new Error(
      `Cyclic import detected: ${[...stack, filePath].join(" -> ")}`
    );
  }
  const tree = parseFile(filePath);
  const dir = path.dirname(filePath);

  const imports = new Map<string, string>();
  for (const node of tree.children) {
    if (node.type !== "mdxjsEsm") continue;
    try {
      for (const { name, source } of parseImports(node as unknown as EsmNode)) {
        imports.set(name, path.resolve(dir, source));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Bad ESM block in ${filePath}: ${msg}`);
    }
  }

  const out: RootContent[] = [];
  for (const node of tree.children) {
    if (node.type === "mdxjsEsm") continue;
    if (node.type === "yaml") {
      if (!opts.stripFrontmatter) out.push(node);
      continue;
    }
    if (node.type === "mdxJsxFlowElement" && typeof node.name === "string") {
      const target = imports.get(node.name);
      if (!target) {
        throw new Error(
          `<${node.name} /> in ${filePath} has no matching import`
        );
      }
      const key = target;
      if (opts.seenShared?.has(key)) {
        out.push({
          type: "paragraph",
          children: [{ type: "text", value: `(see "${node.name}" above)` }],
        });
        continue;
      }
      opts.seenShared?.add(key);
      const inlined = inlineTree(
        target,
        { ...opts, stripFrontmatter: true },
        [...stack, filePath]
      );
      out.push(...inlined.children);
      continue;
    }
    if (node.type === "mdxJsxTextElement") {
      throw new Error(
        `Inline JSX <${(node as { name?: string }).name ?? "?"} /> in ${filePath} is not supported. ` +
          `Use block-level JSX (on its own line).`
      );
    }
    out.push(node);
  }

  return { ...tree, children: out };
}

export function inlineMdx(sourceFile: string, opts: InlineOptions = {}): string {
  const tree = inlineTree(path.resolve(sourceFile), opts, []);
  const out = stringifier.stringify(tree) as string;
  // remark-stringify escapes intra-word underscores (e.g. `LANGWATCH_API_KEY`
  // becomes `LANGWATCH\_API\_KEY`) to be safe against emphasis ambiguity, but
  // CommonMark already treats them as plain text. Restore them.
  return out.replace(/\\_/g, "_");
}
