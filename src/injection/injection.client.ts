import type { Dependencies } from "../../langwatch/langwatch/src/injection/injection.client";
import Subscription from "../pages/subscription";

const dependencies: Dependencies = {
  SubscriptionPage: Subscription,
};

export default dependencies;
