import { Sidebar } from "./ui/Sidebar";
import { Box } from "@chakra-ui/react";
import { Plus, MessageCircle } from "react-feather";

export function PromptStudioSidebar() {
  return (
    <Sidebar.Root>
      <Sidebar.Header>Prompt Studio</Sidebar.Header>
      <Sidebar.Section
        title="Prompts"
        collapsible
        action={
          <Box
            as="button"
            width="20px"
            height="20px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            borderRadius="md"
            _hover={{ bg: "gray.100" }}
            cursor="pointer"
          >
            <Plus size={14} />
          </Box>
        }
      >
        <Sidebar.List>
          <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
            helpful-assistant-prompt
          </Sidebar.Item>
          <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
            coding-assistant-prompt
          </Sidebar.Item>
        </Sidebar.List>
      </Sidebar.Section>
      <Sidebar.Section title="Drafts" collapsible defaultOpen={false}>
        <Sidebar.List>
          <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
            Untitled
          </Sidebar.Item>
          <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
            Untitled
          </Sidebar.Item>
          <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
            Untitled
          </Sidebar.Item>
          <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
            Untitled
          </Sidebar.Item>
          <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
            Untitled
          </Sidebar.Item>
        </Sidebar.List>
      </Sidebar.Section>
      <Sidebar.Section title="Sessions" collapsible>
        <Sidebar.Section title="Saved" collapsible>
          <Sidebar.Item variant="empty">No saved sessions</Sidebar.Item>
        </Sidebar.Section>
        <Sidebar.Section title="History" collapsible>
          <Sidebar.List>
            <Sidebar.Item
              icon={<MessageCircle size={12} color="#666" />}
              meta="Untitled • 10/20/2025"
            >
              asd.
            </Sidebar.Item>
          </Sidebar.List>
        </Sidebar.Section>
      </Sidebar.Section>
    </Sidebar.Root>
  );
}
