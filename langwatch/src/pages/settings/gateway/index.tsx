import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";

import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";

/**
 * AI Gateway index — default landing redirects to the virtual keys list.
 * The section is composed of sibling pages: /settings/gateway/virtual-keys,
 * /settings/gateway/budgets, /settings/gateway/providers,
 * /settings/gateway/usage.
 */
function GatewayIndex() {
  const router = useRouter();
  useEffect(() => {
    void router.replace(`/settings/gateway/virtual-keys`);
  }, [router]);
  return null;
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: AiGatewayLayout,
})(GatewayIndex);
