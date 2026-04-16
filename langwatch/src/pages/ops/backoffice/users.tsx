import BackofficeShell from "./_shell";
import UsersView from "~/components/ops/backoffice/resources/UsersView";

export default function BackofficeUsersPage() {
  return (
    <BackofficeShell>
      <UsersView />
    </BackofficeShell>
  );
}
