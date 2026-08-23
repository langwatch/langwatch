import { capability } from "../shared/capabilities";
import { defineFeature } from "../shared/feature";
import { AgentsFeature } from "./features/agents";

export const agentsServiceComposer = capability<typeof AgentsFeature>(
  "agents.service-composer",
);

export const agentsAppFeature = defineFeature<Record<string, never>>({
  name: "agents",
  provides: [agentsServiceComposer],
  services({ provide }) {
    provide(agentsServiceComposer, AgentsFeature);
  },
});

export const appFeatures = [agentsAppFeature] as const;
