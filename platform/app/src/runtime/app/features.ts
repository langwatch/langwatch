import { Capability, FeatureDefinition } from "@langwatch/runtime-composition";
import { AgentsFeature } from "./features/agents";

export const agentsServiceComposer = Capability.create<typeof AgentsFeature>(
  "agents.service-composer",
);

export const agentsAppFeature = FeatureDefinition.create<Record<string, never>>(
  {
    name: "agents",
    provides: [agentsServiceComposer],
    services({ provide }) {
      provide(agentsServiceComposer, AgentsFeature);
    },
  },
);

export const appFeatures = [agentsAppFeature] as const;
