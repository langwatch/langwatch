import * as React from "react";

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace useMemoizedChatWindowIds {
  /**
   * The properties of the useMemoizedChatWindowIds hook.
   */
  export interface Props {
    /**
     * The list of chat windows to memoize the ids of. We reduce the chat window
     * interface by purpose to keep this hook loosely coupled with the rest of
     * the application.
     */
    chatWindows?: Array<{ id: string }>;
  }
  /**
   * Returns a memoized list of chat window ids. The reference of the array is
   * always the same unless the content of the array changes. (The hook computes
   * a hash of the chat window ids and uses it)
   */
  export type Return = string[] | undefined;
}
/**
 * Memoize the list of chat window ids. Regardless of how many times the chat
 * window list is copied over into new instance of an array this hook will
 * always return the reference to the same array unless the content of the
 * array changes. (The hook computes a hash of the chat window ids and uses it)
 *
 * @param props.chatWindows The list of chat windows to memoize the ids of.
 *    We reduce the chat window interface by purpose to keep this hook loosely
 *    coupled with the rest of the application..
 * @returns Returns a memoized list of chat window ids. The reference of
 *    the array is always the same unless the content of the array changes.
 *    (The hook computes a hash of the chat window ids and uses it)
 */
export function useMemoizedChatWindowIds({
  chatWindows = [],
}: useMemoizedChatWindowIds.Props): useMemoizedChatWindowIds.Return {
  // The simplest way to hash the array of chat window ids is just to
  // concatenated them with a separator of some sort. (The chat window
  // ids are alphanumeric strings, therefor any special char as separator
  // should be fine)
  const chatWindowMemoHash = (
    chatWindows.map((chatWindow) => chatWindow.id) || []
  )
    // Always sort the chat window ids before hashing them to ensure that
    // the hash is always the same regardless of the order of the chat
    // windows in the array. (If it is arbitrary)
    .sort()
    .join(":");

  const memoizedChatWindowIds = React.useMemo(
    () => chatWindows.map((chatWindow) => chatWindow.id),
    // We explicitly want to change the array only if the content of it
    // changes not the reference to the chat window objects.
    // The PlaygroundStore returns a new array of chat windows every time
    // the state changes, so we can use the hash to determine if the
    // chat window ids have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chatWindowMemoHash]
  );

  return memoizedChatWindowIds;
}
