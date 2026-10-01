import { generate } from "@langwatch/ksuid";
import { useRef } from "react";

export function useTabSessionId(): string {
  const ref = useRef<string>("");
  if (typeof window === "undefined") return ref.current;
  if (!ref.current) {
    const cached = (window as { __lw_presence_session_id?: string }).__lw_presence_session_id;
    if (cached) {
      ref.current = cached;
    } else {
      ref.current = generate("presence").toString();
      (window as { __lw_presence_session_id?: string }).__lw_presence_session_id = ref.current;
    }
  }
  return ref.current;
}
