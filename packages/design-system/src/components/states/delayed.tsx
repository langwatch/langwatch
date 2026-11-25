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
    const mountTimeout = setTimeout(() => setIsMounted(true), delay);
    return () => clearTimeout(mountTimeout);
  }, [delay]);

  if (isMounted) return children;
  if (takeSpace) return <span style={{ opacity: 0 }}>{children}</span>;
  return null;
}
