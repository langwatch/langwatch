import { Sidebar } from "./ui/Sidebar";

export function SessionSnapshotsList() {
  return (
    <Sidebar.List title="Saved" collapsible>
      <Sidebar.Item variant="empty">No saved sessions</Sidebar.Item>
    </Sidebar.List>
  );
}
