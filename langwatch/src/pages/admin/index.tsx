import ClientAdminWrapper from "../../../ee/admin/ClientAdminWrapper";

// getServerSideProps removed — admin auth guard is handled client-side
export default function AdminPage() {
  return <ClientAdminWrapper />;
}
