import { Sidebar } from "./ui/Sidebar";
import { Box } from "@chakra-ui/react";
import { Plus, MessageCircle } from "react-feather";

export function PublishedPromptsList() {
  return (
    <Sidebar.List
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
      <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
        helpful-assistant-prompt
      </Sidebar.Item>
      <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
        coding-assistant-prompt
      </Sidebar.Item>
    </Sidebar.List>
  );
}
