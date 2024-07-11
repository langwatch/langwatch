import * as React from "react";

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace useMemoizedChatWindowIds {
  export interface Props {
    chatWindows?: Array<{ id: string }>;
  }

  export type Return = string[] | undefined;
}

export function useMemoizedChatWindowIds({
  chatWindows = [],
}: useMemoizedChatWindowIds.Props): useMemoizedChatWindowIds.Return {
  const chatWindowMemoHash = (
    chatWindows.map((chatWindow) => chatWindow.id) || []
  )
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
