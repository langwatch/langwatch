import { SubscriptionHandler } from "../server/subscriptionHandler";

export interface Dependencies {
  subscriptionHandler: typeof SubscriptionHandler;
}

const dependencies: Dependencies = {
  subscriptionHandler: SubscriptionHandler,
};

export default dependencies;
