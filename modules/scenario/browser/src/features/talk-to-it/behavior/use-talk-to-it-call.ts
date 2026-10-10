import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { initialTalkState } from "../model/talk-to-it-machine.ts";
import type { TalkToItPanelProps } from "../model/talk-to-it-props.ts";
import { talkReducer } from "../model/talk-to-it-transitions.ts";
import { createTalkRefs, leaveCall, runHrefOf, type TalkRefs } from "./talk-to-it-refs.ts";
import { runFinish } from "./talk-to-it-session.ts";
import { runEndCall, runStart } from "./talk-to-it-start.ts";

/** All the call state and callbacks the panel and its views render from. */
export function useTalkToItCall(props: TalkToItPanelProps) {
  const [state, dispatch] = useReducer(talkReducer, initialTalkState);
  const [micLevel, setMicLevel] = useState(0);
  const [pendingName, setPendingName] = useState("");
  const refsRef = useRef<TalkRefs | null>(null);
  refsRef.current ??= createTalkRefs(props.agentRowId);
  const refs = refsRef.current;
  // A counter, not a boolean: Strict Mode's replay invalidates only the first attempt.
  const attemptRef = useRef(0);
  refs.stateRef.current = state;

  const finish = useCallback(
    ({ isCutAtLimit, nameOverride }: { isCutAtLimit: boolean; nameOverride?: string }) =>
      runFinish({ props, refs, dispatch, isCutAtLimit, nameOverride }),
    [props, refs],
  );
  const endCall = useCallback(
    (isCutAtLimit: boolean) => void runEndCall({ refs, dispatch, finish, isCutAtLimit }),
    [refs, finish],
  );
  const start = useCallback(() => {
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    return runStart({
      props,
      refs,
      dispatch,
      setMicLevel,
      endCall,
      isStale: () => attemptRef.current !== attempt,
    });
  }, [props, refs, endCall]);
  const saveWithName = useCallback(
    ({ isCutAtLimit, name }: { isCutAtLimit: boolean; name: string }) => {
      dispatch({ type: "HANG_UP" });
      void finish({ isCutAtLimit, nameOverride: name });
    },
    [finish],
  );

  // Pressing "Talk to it" is the trigger: the call opens on mount; unmounting ends it (#18).
  useEffect(() => {
    const attempts = attemptRef;
    void start();
    return () => {
      attempts.current += 1;
      leaveCall({ refs, endCall });
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the call opens once per mount
  }, []);

  return {
    state,
    micLevel,
    pendingName,
    setPendingName,
    start,
    endCall,
    saveWithName,
    maxSeconds: refs.maxSeconds.current,
    runHref: runHrefOf({
      state,
      runSetId: refs.runSetId.current,
      projectSlug: props.projectSlug,
    }),
  };
}
