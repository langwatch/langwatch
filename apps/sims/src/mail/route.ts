import { useCallback, useEffect, useState } from "react";

const MESSAGE_PATH = /^\/messages\/([^/]+)\/?$/u;

/** The open message's id, from a /messages/{id} path; "" on the inbox. */
export const messageIdFromPath = ({ pathname }: { pathname: string }) => {
  const encoded = MESSAGE_PATH.exec(pathname)?.[1];
  return encoded === undefined ? "" : decodeURIComponent(encoded);
};

export const messageHref = ({ id }: { id: string }) =>
  id === "" ? "/" : `/messages/${encodeURIComponent(id)}`;

/** The open message, kept in the address bar so a message can be linked to. */
export const useOpenMessage = () => {
  const [openId, setOpenId] = useState(() =>
    messageIdFromPath({ pathname: window.location.pathname }),
  );
  useEffect(() => {
    const onPop = () => setOpenId(messageIdFromPath({ pathname: window.location.pathname }));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const open = useCallback(({ id }: { id: string }) => {
    const href = messageHref({ id });
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
    setOpenId(id);
  }, []);
  return { openId, open };
};
