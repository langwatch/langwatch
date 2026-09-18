/** Adapts portable byte iterators without draining ahead of downstream demand. */
export function readableByteStream(
  source: ReadableStream | AsyncIterable<Uint8Array>,
  onCancel?: (reason: unknown) => void | Promise<void>,
): ReadableStream {
  const stream = source instanceof ReadableStream ? source : iteratorStream(source);

  if (!onCancel) {
    return stream;
  }

  const reader = stream.getReader();

  return new ReadableStream({
    async pull(controller) {
      try {
        const chunk = await reader.read();

        if (chunk.done) {
          controller.close();
          reader.releaseLock();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        controller.error(error);
        reader.releaseLock();
      }
    },
    async cancel(reason: unknown) {
      try {
        await onCancel(reason);
      } finally {
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      }
    },
  });
}

function iteratorStream(source: AsyncIterable<Uint8Array>): ReadableStream {
  const iterator = source[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await iterator.next();

        if (chunk.done) {
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        controller.error(error);
        await iterator.return?.();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
