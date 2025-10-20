import { Sidebar } from "./ui/Sidebar";
import { MessageCircle } from "react-feather";

export function ConversationHistoryList() {
  return (
    <Sidebar.List title="History" collapsible>
      <Sidebar.Item
        icon={<MessageCircle size={12} color="#666" />}
        meta="Untitled • 10/20/2025"
      >
        asd.
      </Sidebar.Item>
    </Sidebar.List>
  );
}
