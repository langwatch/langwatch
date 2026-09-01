/**
 * The group queue, as the rest of this package composes it.
 *
 * A private feature's public entry: everything another feature in this package
 * may name, and nothing else. The event-store's Ops dashboard is the one caller
 * — the landing page reads the queue's health beside the event log's — and it
 * reaches this list rather than the modules behind it, so the queue's internals
 * can move without a search across the package.
 */

export { AnomaliesCard } from "./ui/sections/anomalies-card";
export { BlockedCard } from "./ui/sections/blocked-card";
export { DlqCard } from "./ui/sections/dlq-card";
export { GroupsCard } from "./ui/sections/groups-card";
export { PipelineTreeCard } from "./ui/sections/pipeline-tree-card";
