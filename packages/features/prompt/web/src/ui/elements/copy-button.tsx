/**
 * Copies one value and tells the caller what happened.
 *
 * A family-local copy of `platform/app/src/components/CopyButton.tsx`, narrowed
 * in one way: the application's version reached the toast singleton directly,
 * and a feature-web package may not. The outcome is handed back through
 * `onCopied` / `onRefused` so the screen tells the host, which is what decides
 * the words a reader sees.
 */

import { Button, type ButtonProps } from "@chakra-ui/react";
import { CopyIcon } from "lucide-react";

interface CopyButtonProps extends Omit<ButtonProps, "value" | "label" | "onClick"> {
  value: string;
  label: string;
  onCopied: (label: string) => void;
  onRefused: () => void;
}

export function CopyButton(props: CopyButtonProps) {
  const { value, label, onCopied, onRefused, ...rest } = props;

  return (
    <Button
      variant="ghost"
      data-variant="ghost"
      size="sm"
      cursor="pointer"
      onClick={(event) => {
        if (!value) return;
        event.stopPropagation();

        if (!navigator.clipboard) {
          onRefused();
          return;
        }

        void (async () => {
          await navigator.clipboard.writeText(value);
          onCopied(label);
        })();
      }}
      {...rest}
    >
      <CopyIcon width={14} height={14} />
    </Button>
  );
}
