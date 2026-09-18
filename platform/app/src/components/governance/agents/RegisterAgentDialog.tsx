import { Text, VStack } from "@chakra-ui/react";

import { RenderCode } from "~/components/code/RenderCode";
import { useColorMode } from "~/components/ui/color-mode";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from "~/components/ui/dialog";

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

export function RegisterAgentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { colorMode } = useColorMode();
  return (
    <DialogRoot
      open={open}
      onOpenChange={({ open: nowOpen }) => {
        if (!nowOpen) onClose();
      }}
      size="lg"
    >
      <DialogContent errorScope="Register agent">
        {/* Column, not the header's default row: the title and the sentence
            under it are one block, and side by side the title squeezes into a
            three-line column beside the paragraph. */}
        <DialogHeader flexDirection="column" alignItems="start" gap={2}>
          <DialogTitle>Register an agent</DialogTitle>
          <DialogDescription>
            An agent registers itself from the process that runs it. Decorate
            the function behind your agent, start the process, and it appears on
            this page with its environment, its models and its spend.
          </DialogDescription>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody>
          <VStack align="stretch" gap={4} paddingBottom={4}>
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
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
}
