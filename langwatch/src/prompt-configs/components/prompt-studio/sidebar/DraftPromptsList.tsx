import { Sidebar } from "./ui/Sidebar";
import { MessageCircle } from "react-feather";

export function DraftPromptsList() {
  return (
    <Sidebar.List title="Drafts" collapsible defaultOpen={false}>
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
  );
}
