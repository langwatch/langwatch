import type { ReactNode } from "react";

import { flag } from "./class-names.ts";
import { CopyButton } from "./copy-button.tsx";

export type KeyValueItem = {
  label: string;
  value: ReactNode;
  /** Mono by default: values here are hosts, ports, ids and paths. */
  mono?: boolean;
  /** `true` (the default for a string value) copies the value; a string copies that instead. */
  copy?: boolean | string;
};

export type KeyValueProps = { items: KeyValueItem[] };

const copyTextOf = ({ item }: { item: KeyValueItem }): string | undefined => {
  if (typeof item.copy === "string") return item.copy;
  if (item.copy === false) return undefined;
  return typeof item.value === "string" ? item.value : undefined;
};

export const KeyValue = ({ items }: KeyValueProps) => (
  <dl className="ds-kv">
    {items.map((item) => {
      const copyText = copyTextOf({ item });
      return (
        <div className="ds-kv-row" key={item.label}>
          <dt title={item.label}>{item.label}</dt>
          <dd>
            <span
              className="ds-kv-value"
              data-mono={flag({ on: item.mono ?? true })}
              title={typeof item.value === "string" ? item.value : undefined}
            >
              {item.value}
            </span>
            {copyText !== undefined && (
              <CopyButton value={copyText} label={`Copy ${item.label.toLowerCase()}`} />
            )}
          </dd>
        </div>
      );
    })}
  </dl>
);
