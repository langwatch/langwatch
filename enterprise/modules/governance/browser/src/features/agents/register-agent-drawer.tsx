import { useDrawer } from "@langwatch/browser-host/drawer";
import { CodePreview } from "@langwatch/design-system/code-preview";
import { Drawer } from "@langwatch/design-system/drawer";
import { Text, VStack } from "@langwatch/design-system/primitives";

/**
 * "Register agent" opens instructions, not a form: agents register themselves through the SDK
 * (ADR-128). A URL-routed drawer (`addAgent`) with no footer, since it collects and persists
 * nothing.
 * @see specs/ai-governance/dashboard/agents-page.feature
 * @see dev/docs/best_practices/drawers.md
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
              An agent registers itself from the process that runs it. Decorate the function behind
              your agent, start the process, and it appears on this page with its environment, its
              models and its spend.
            </Text>
            <VStack align="stretch" gap={2}>
              <Text textStyle="sm" fontWeight="semibold">
                Python
              </Text>
              <CodePreview code={PYTHON_SNIPPET} language="python" />
            </VStack>
            <VStack align="stretch" gap={2}>
              <Text textStyle="sm" fontWeight="semibold">
                TypeScript
              </Text>
              <CodePreview code={TYPESCRIPT_SNIPPET} language="typescript" />
            </VStack>
            <Text textStyle="sm" color="fg.muted">
              The process needs a LangWatch API key in its environment. Nothing listens on your side
              and no public address is involved: the connection is outbound only.
            </Text>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
