import BackofficeShell from "./_shell";
import UsersView from "../../../../ee/admin/backoffice/resources/UsersView";

export default function BackofficeUsersPage() {
  return (
    <BackofficeShell>
      <UsersView />
    </BackofficeShell>
  );
}
