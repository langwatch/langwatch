import {
  Controls,
  Description,
  Heading,
  Markdown,
  Primary,
  Stories,
  Subtitle,
  Title,
  useOf,
} from "@storybook/addon-docs/blocks";

import { adoption, entriesForStory } from "./adoption-data.ts";

/** A story's `parameters.usage`: when to reach for it, and what to use instead. */
export type Usage = { use: string; avoid?: string };

function usageMarkdown({ usage }: { usage: Usage }): string {
  const avoid = usage.avoid ? `\n\n**Not for:** ${usage.avoid}` : "";
  return `**Use for:** ${usage.use}${avoid}`;
}

function adoptionOf({ fileName }: { fileName: string }) {
  if (!adoption) return undefined;
  const entries = entriesForStory({ fileName });
  if (entries.length === 0) return undefined;
  const files = entries.reduce((sum, [, entry]) => sum + entry.files, 0);
  const rows = entries.map(([subpath, entry]) => {
    const owners = Object.entries(entry.owners)
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([owner, count]) => `${owner} (${count})`)
      .join(", ");
    return `| \`@langwatch/design-system${subpath.slice(1)}\` | ${entry.files} | ${owners || "none yet"} |`;
  });
  const table = ["| Import | Files | Most used in |", "| --- | --- | --- |", ...rows].join("\n");
  return { files, table };
}

/**
 * Every docs page, laid out like Chakra's: what it is and when to use it, the
 * example, its other states, then props. How widely it is used folds away at the end.
 */
export function DocsPage() {
  const resolved = useOf("meta");
  const parameters = resolved.type === "meta" ? resolved.preparedMeta.parameters : {};
  const hasProps = resolved.type === "meta" && resolved.preparedMeta.component !== undefined;
  const { fileName, usage } = parameters as { fileName?: string; usage?: Usage };
  const used = fileName ? adoptionOf({ fileName }) : undefined;
  return (
    <>
      <Title />
      <Subtitle />
      <Description />
      {usage ? <Markdown>{usageMarkdown({ usage })}</Markdown> : null}
      <Primary />
      <Stories title="Examples" includePrimary={false} />
      {hasProps ? (
        <>
          <Heading>Props</Heading>
          <Controls />
        </>
      ) : null}
      {used ? (
        <details>
          <summary>
            Used in {used.files} {used.files === 1 ? "file" : "files"}
          </summary>
          <Markdown>{used.table}</Markdown>
        </details>
      ) : null}
    </>
  );
}
