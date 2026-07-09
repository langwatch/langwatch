import { Center, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import ErrorPage from "~/utils/compat/next-error";
import { useRouter } from "~/utils/compat/next-router";
import { DashboardLayout } from "../../components/DashboardLayout";
import { TraceDetails } from "../../components/traces/TraceDetails";
import { api } from "../../utils/api";

export default function SharePage() {
  const router = useRouter();
  const token = typeof router.query.id === "string" ? router.query.id : "";

  // Exchange the share token for a scoped viewing grant (httpOnly cookie) before
  // rendering. The trace/spans/evaluations reads below authorize on that grant,
  // so they must not fire until it is set. One resolve == one view. See ADR-039.
  const resolve = api.share.resolve.useMutation();
  const attempted = useRef(false);
  useEffect(() => {
    if (token && !attempted.current) {
      attempted.current = true;
      resolve.mutate({ token });
    }
  }, [token, resolve]);

  if (resolve.isError) {
    return (
      <Center height="100vh" padding={8}>
        <Text color="fg.muted">
          {resolve.error.message || "This share link is not available."}
        </Text>
      </Center>
    );
  }

  if (!resolve.isSuccess) {
    return null;
  }

  if (resolve.data.resourceType !== "TRACE") {
    // Only trace shares render for now.
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout publicPage>
      <TraceDetails traceId={resolve.data.resourceId} />
    </DashboardLayout>
  );
}
