/**
 * The add control under the test suites: a blank suite names an empty one, a template opens the
 * gallery.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import { Menu } from "@langwatch/design-system/menu";
import { Button } from "@langwatch/design-system/primitives";
import { LayoutTemplate, Plus, SquarePlus } from "lucide-react";

export function SuiteRailAddMenu({
  onBlankSuite,
  onFromTemplate,
}: {
  onBlankSuite: () => void;
  onFromTemplate: () => void;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          justifyContent="flex-start"
          width="full"
          height="28px"
          paddingX={2}
          color="fg.muted"
          fontWeight="normal"
          data-testid="agent-testing-rail-new-suite"
        >
          <Plus size={14} />
          New test suite
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="blank"
          data-testid="agent-testing-rail-new-blank-suite"
          onClick={onBlankSuite}
        >
          <SquarePlus size={14} />
          Blank suite
        </Menu.Item>
        <Menu.Item
          value="template"
          data-testid="agent-testing-rail-new-suite-from-template"
          onClick={onFromTemplate}
        >
          <LayoutTemplate size={14} />
          From template
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
