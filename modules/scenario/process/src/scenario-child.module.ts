/**
 * The voice transports the scenario child still takes from this package: the live voice session
 * runs them here too, until it spawns a child of its own. Everything else the child runs is its
 * own (apps/scenario-child), and this entry shrinks to nothing once voice moves there as well.
 */

export {
  createSerializedVoiceAgentAdapter,
  createVoiceTransportRegistry,
} from "./channels/voice-transport.channels.ts";
