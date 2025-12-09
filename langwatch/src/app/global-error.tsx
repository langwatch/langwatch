"use client";

import NextError from "next/error";
import { useEffect } from "react";
import { captureException } from "~/utils/posthogErrorCapture";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        {/* @ts-ignore */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
