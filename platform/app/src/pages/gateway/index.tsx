import { useEffect } from "react";
import AiGatewayLayout from "~/components/gateway/AiGatewayLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useRouter } from "~/utils/compat/next-router";

/**
 * AI Gateway index — default landing redirects to the virtual keys list.
 * The section is composed of sibling pages: /gateway/virtual-keys,
 * /gateway/budgets, /gateway/providers,
 * /gateway/usage.
 */
function GatewayIndex() {
  const router = useRouter();
  useEffect(() => {
    void router.replace(`/gateway/virtual-keys`);
  }, [router]);
  return null;
}

export default withPermissionGuard("virtualKeys:view", {
  layoutComponent: AiGatewayLayout,
})(GatewayIndex);
