import { flag } from "./class-names.ts";
import { CopyButton } from "./copy-button.tsx";

export type CodeBlockProps = {
  code: string;
  /** Names the block for screen readers, e.g. "Shell command". */
  label?: string;
  copy?: boolean;
  /** Wrap long lines instead of scrolling sideways. */
  wrap?: boolean;
};

export const CodeBlock = ({ code, label, copy = true, wrap = false }: CodeBlockProps) => (
  <div className="ds-codeblock" data-copy={flag({ on: copy })} data-wrap={flag({ on: wrap })}>
    <pre aria-label={label}>
      <code>{code}</code>
    </pre>
    {copy && (
      <div className="ds-codeblock-copy">
        <CopyButton value={code} />
      </div>
    )}
  </div>
);
