/**
 * What a simulation run points at.
 *
 * The target is domain shape rather than transport shape, so the services
 * that resolve it and the router that accepts it read the same definition.
 * Extensible: add a new type as the platform grows one.
 */

import { z } from "zod";

export const simulationTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow", "connected"]),
  referenceId: z.string(),
});

export type SimulationTarget = z.infer<typeof simulationTargetSchema>;
