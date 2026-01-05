import { useState } from "react";

import { PromptListDrawer } from "~/components/prompts/PromptListDrawer";
import { PromptSelectionButton } from "./ui/PromptSelectButton";

type PromptSourceProps = {
  selectedPromptId?: string;
  onSelect: (config: { id: string; name: string }) => void;
};

/**
 * Component for selecting a prompt source in the optimization studio.
 * Opens a drawer to list and select from existing prompts.
 */
export function PromptSource({ onSelect }: PromptSourceProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (prompt: { id: string; name: string }) => {
    onSelect(prompt);
    setIsOpen(false);
  };

  return (
    <>
      <PromptSelectionButton onClick={() => setIsOpen(true)} />
      <PromptListDrawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
        onSelect={handleSelect}
        onCreateNew={() => {
          // Close the drawer - user will use the main prompt creation flow
          setIsOpen(false);
        }}
      />
    </>
  );
}
