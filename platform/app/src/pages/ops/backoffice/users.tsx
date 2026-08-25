import UsersView from "~/components/ops/backoffice/resources/UsersView";
import BackofficeShell from "./_shell";

export default function BackofficeUsersPage() {
  return (
    <BackofficeShell>
      <UsersView />
    </BackofficeShell>
  );
}
