import { Text, VStack } from "@chakra-ui/react";

import { RenderCode } from "~/components/code/RenderCode";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer } from "~/hooks/useDrawer";

/**
 * "Register agent" opens instructions, not a form.
 *
 * An agent registers itself: the customer decorates the function that runs it
 * and the SDK opens the connection (ADR-128). The platform refuses to create a
 * connected agent any other way — `AgentService.create` throws
 * `agent_register_only` — so a name-and-environment form here would collect
 * fields nothing could persist and leave the reader waiting for a row that
 * never arrives. The honest action is to show them the three lines that do
 * work.
 *
 * A DRAWER RATHER THAN A MODAL, which is what changed. It was a Chakra
 * `DialogRoot`, and the product owner asked for the section's ordinary
 * right-side drawer instead. That is not only a shape: a drawer here is
 * URL-routed, so `?drawer.open=addAgent` reopens it from a paste, browser back
 * closes it, and another screen can reach it by address alone
 * (`dev/docs/best_practices/drawers.md`). It is registered in `drawerRegistry`
 * as `addAgent` and mounted by `CurrentDrawer`, never by the page that opens
 * it — the Agents page calls `openDrawer` and holds no open state of its own.
 *
 * NO FOOTER, AND THAT IS THE POINT. The sibling `AddDepartmentDrawer` closes
 * with a solid orange submit, and the section's button rule carves drawer
 * footers out precisely so it can. This drawer has nothing to submit: it
 * collects no fields and persists nothing, so a footer button would either
 * duplicate the close control in the header or, drawn solid, claim an action
 * the flow does not have. The exemption is available and deliberately unused.
 *
 * Both languages, side by side rather than behind a picker: the reader knows
 * which of the two they write, and a picker would hide half the answer behind
 * a click to save six lines of height.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

const PYTHON_SNIPPET = `import langwatch

@langwatch.connect_agent(name="support-copilot", environment="production")
def support_copilot(messages, thread_id):
    return my_agent.run(messages)`;

const TYPESCRIPT_SNIPPET = `import { connectAgent } from "langwatch/agent";

connectAgent(
  { name: "support-copilot", environment: "production" },
  async ({ messages, threadId }) => myAgent.run(messages),
);`;

export function RegisterAgentDrawer({ open = true }: { open?: boolean }) {
  const { colorMode } = useColorMode();
  const { closeDrawer } = useDrawer();

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="md"
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) closeDrawer();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Register an agent</Drawer.Title>
          {/* No `onClick` of its own. The trigger already closes the drawer,
              which fires `onOpenChange` above, and wiring `closeDrawer` here
              as well would navigate twice for one dismissal. */}
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4} paddingBottom={4}>
            <Text textStyle="sm" color="fg.muted">
              An agent registers itself from the process that runs it. Decorate
              the function behind your agent, start the process, and it appears
              on this page with its environment, its models and its spend.
            </Text>
            <VStack align="stretch" gap={2}>
              <Text textStyle="sm" fontWeight="semibold">
                Python
              </Text>
              <RenderCode
                code={PYTHON_SNIPPET}
                language="python"
                colorMode={colorMode === "dark" ? "dark" : "light"}
              />
            </VStack>
            <VStack align="stretch" gap={2}>
              <Text textStyle="sm" fontWeight="semibold">
                TypeScript
              </Text>
              <RenderCode
                code={TYPESCRIPT_SNIPPET}
                language="typescript"
                colorMode={colorMode === "dark" ? "dark" : "light"}
              />
            </VStack>
            <Text textStyle="sm" color="fg.muted">
              The process needs a LangWatch API key in its environment. Nothing
              listens on your side and no public address is involved: the
              connection is outbound only.
            </Text>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
