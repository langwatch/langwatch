import type {
  CancellationMessage,
  CancellationPublisher,
  CancellationSubscriber,
} from "../app/scenario.app.ts";

/** The cancel signal every replica's running children listen for: published once, heard by all. */
export abstract class ScenarioCancellationRepository
  implements CancellationPublisher, CancellationSubscriber
{
  abstract publish(message: CancellationMessage): Promise<void>;

  abstract subscribe(
    onCancellation: (message: CancellationMessage) => void,
  ): Promise<() => Promise<void>>;
}
