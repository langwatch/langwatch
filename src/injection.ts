import type { Dependencies } from "../langwatch/langwatch/src/injection";
import { SubscriptionHandlerSass } from "./subscriptionHandler";

const dependencies: Dependencies = {
  subscriptionHandler: SubscriptionHandlerSass,
};

export default dependencies;
