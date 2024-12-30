import { useEffect, useState } from "react";

export function Delayed({
  children,
  delay = 100,
  takeSpace = false,
}: {
  children: React.ReactNode;
  delay?: number;
  takeSpace?: boolean;
}) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setTimeout(() => setIsMounted(true), delay);
  }, [delay]);

  return isMounted ? (
    children
  ) : takeSpace ? (
    <span style={{ opacity: 0 }}>{children}</span>
  ) : null;
}
