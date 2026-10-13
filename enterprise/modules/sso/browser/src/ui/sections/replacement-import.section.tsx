// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The back office's import of a customer-supplied configuration as the
 * replacement for a carried-over connection, lent to ops (ARCHITECTURE.md §10.1).
 * Main's RegisterConnection mode="operator".
 */
import type { SsoReplacementImportProps } from "@langwatch/enterprise-sso-contract";

import { RegisterConnectionSection } from "./register-connection.section.tsx";

export function SsoReplacementImport({
  organizationId,
  replacesConnectionId,
}: SsoReplacementImportProps) {
  return (
    <RegisterConnectionSection
      organizationId={organizationId}
      canManage
      replacesConnectionId={replacesConnectionId}
      mode="operator"
    />
  );
}

export default SsoReplacementImport;
