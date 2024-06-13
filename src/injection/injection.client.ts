import type { Dependencies } from "../../langwatch/langwatch/src/injection/injection.client";
import { ImpersonationSwitchBackMenuItem } from "../components/ImpersonationSwitchBackMenuItem";
import Subscription from "../pages/subscription";
import Admin from "../pages/admin";
import { ExtraFooterComponents } from "../components/ExtraFooterComponents";
import { ExtraFooterComponentsScripts } from "../components/ExtraFooterComponentsScripts";

const dependencies: Dependencies = {
  SubscriptionPage: Subscription,
  ExtraMenuItems: ImpersonationSwitchBackMenuItem,
  extraPagesRoutes: {
    "/admin": Admin,
  },
  ExtraFooterComponents,
  ExtraFooterComponentsScripts,
};

export default dependencies;
