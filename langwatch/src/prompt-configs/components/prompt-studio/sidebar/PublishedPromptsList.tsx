import { Sidebar } from "./ui/Sidebar";
import { MessageCircle } from "react-feather";

export function PublishedPromptsList() {
  return (
    <Sidebar.List>
      <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
        helpful-assistant-prompt
      </Sidebar.Item>
      <Sidebar.Item icon={<MessageCircle size={12} color="#666" />}>
        coding-assistant-prompt
      </Sidebar.Item>
    </Sidebar.List>
  );
}
