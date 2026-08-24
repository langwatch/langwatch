import UsersView from "~/features/enterprise/admin/backoffice/resources/UsersView";
import BackofficeShell from "./_shell";

export default function BackofficeUsersPage() {
  return (
    <BackofficeShell>
      <UsersView />
    </BackofficeShell>
  );
}
