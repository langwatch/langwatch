import UsersView from "../../../../ee/admin/backoffice/resources/UsersView";
import BackofficeShell from "./_shell";

export default function BackofficeUsersPage() {
  return (
    <BackofficeShell>
      <UsersView />
    </BackofficeShell>
  );
}
