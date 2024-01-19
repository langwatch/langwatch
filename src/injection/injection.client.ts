import type { Dependencies } from "../../langwatch/langwatch/src/injection/injection.client";
import { ImpersonationSwitchBackMenuItem } from "../components/ImpersonationSwitchBackMenuItem";
import Subscription from "../pages/subscription";
import Admin from "../pages/admin";

const dependencies: Dependencies = {
  SubscriptionPage: Subscription,
  ExtraMenuItems: ImpersonationSwitchBackMenuItem,
  extraPagesRoutes: {
    "/admin": Admin,
  },
};

export default dependencies;
