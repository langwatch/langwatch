export abstract class QueuePayloadDecoderPort {
  abstract tryDecode(input: {
    queueName: string;
    value: string;
  }): Promise<Record<string, unknown> | null>;
}
