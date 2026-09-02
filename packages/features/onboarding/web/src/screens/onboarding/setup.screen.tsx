/**
 * `/:project/setup` — the integration guide a project lands on before its first
 * trace arrives.
 *
 * TWO WRAPPERS DID NOT TRAVEL, and both are the application's rather than this
 * screen's. `DashboardLayout` is drawn by the chrome layout route above every
 * page `apps/ui` serves, so rendering it here would give the address two of
 * everything; and `withPermissionGuard("project:view")` is `withUiPageGuard` in
 * the frontend feature, which is where the same policy — flags before
 * permissions, nothing refused while an answer is still arriving — now lives.
 */

import WelcomeLayout from "../../components/welcome/WelcomeLayout";

export default function SetupGuide() {
  return <WelcomeLayout />;
}
