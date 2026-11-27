/**
 * One ask at a time until a payment settles. A return while an ask is out asks again once that
 * one answers, so no return is lost; nothing is reported after stop.
 */
export function paymentAsker<Answer>({
  ask,
  isSettled,
  onSettled,
}: {
  ask: () => Promise<Answer>;
  isSettled: (answer: Answer) => boolean;
  onSettled: (answer: Answer) => void;
}) {
  let live = true;
  let asking = false;
  let askAgain = false;
  const next = async (): Promise<void> => {
    if (!live) return;
    if (asking) {
      askAgain = true;
      return;
    }
    asking = true;
    const answer = await ask();
    asking = false;
    if (!live) return;
    if (isSettled(answer)) {
      live = false;
      onSettled(answer);
      return;
    }
    if (!askAgain) return;
    askAgain = false;
    await next();
  };
  return {
    ask: next,
    stop: () => {
      live = false;
    },
  };
}

/** Asks each time the admin comes back to this window, until the asker settles or unmounts. */
export function askOnReturn(asker: { ask: () => Promise<void>; stop: () => void }): () => void {
  const onFocus = () => void asker.ask();
  window.addEventListener("focus", onFocus);
  return () => {
    asker.stop();
    window.removeEventListener("focus", onFocus);
  };
}
