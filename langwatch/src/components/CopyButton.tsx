import { Button } from "@chakra-ui/react";
import { CopyIcon } from "lucide-react";
import { toaster } from "./ui/toaster";

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      cursor="pointer"
      onClick={(event) => {
        if (!value) return;
        event.stopPropagation();

        if (!navigator.clipboard) {
          toaster.create({
            title: `Your browser does not support clipboard access, please copy the prompt ID manually`,
            type: "error",
            duration: 2000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
          return;
        }

        void (async () => {
          await navigator.clipboard.writeText(value);
          toaster.create({
            title: `${label} copied to your clipboard`,
            type: "success",
            duration: 2000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        })();
      }}
    >
      <CopyIcon width={14} height={14} />
    </Button>
  );
}
