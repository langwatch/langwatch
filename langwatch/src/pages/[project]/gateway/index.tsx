import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";

import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * AI Gateway index — default route redirects to the virtual keys list. The
 * section is composed of sibling pages: /gateway/virtual-keys, /gateway/budgets,
 * /gateway/providers, /gateway/usage. Keeping the index lightweight avoids a
 * dead landing page.
 */
function GatewayIndex() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  useEffect(() => {
    if (project?.slug) {
      void router.replace(`/${project.slug}/gateway/virtual-keys`);
    }
  }, [project?.slug, router]);
  return null;
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: AiGatewayLayout,
})(GatewayIndex);
