import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { useColorRawValue } from "../../../../../components/ui/color-mode";
import { useActiveProject } from "../../../contexts/ActiveProjectContext";
import { api } from "~/utils/api";
import { useRouter } from "next/router";
import { CheckCircle } from "react-feather";

export function WaitingForTracesChip(): React.ReactElement {
  const accent = useColorRawValue("orange.400");
  const success = useColorRawValue("green.400");
  const router = useRouter();
  const { project } = useActiveProject();

  const [detected, setDetected] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );

  useEffect(() => {
    const onVisibility = () =>
      setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const timeBounds = useMemo(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;
    return { startDate: now - sevenDays, endDate: now + oneDay };
  }, []);

  const tracesQuery = api.traces.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: timeBounds.startDate,
      endDate: timeBounds.endDate,
      filters: {},
      groupBy: "none",
      pageSize: 1,
    },
    {
      enabled: !!project?.id && !detected,
      refetchInterval: isVisible ? 3000 : false,
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    const count = tracesQuery.data?.groups?.flat().length ?? 0;
    if (!detected && count > 0) {
      setDetected(true);
    }
  }, [tracesQuery.data, detected]);

  const goToTraces = useCallback((): void => {
    if (!project?.slug) return;

    const traceId = tracesQuery.data?.groups?.flat().at(0)?.trace_id ?? void 0;
    const firstSpanId =
      tracesQuery.data?.groups?.flat().at(0)?.spans?.at(0)?.span_id ?? void 0;

    if (!traceId) {
      window.location.href = `/${project.slug}/messages`;
      return;
    }

    const params = new URLSearchParams({
      view: "table",
      project: project.slug,
      pageOffset: "0",
      pageSize: "25",
      "drawer.traceId": traceId,
      "drawer.open": "traceDetails",
      "drawer.selectedTab": "traceDetails",
    });
    if (firstSpanId) {
      params.set("span", firstSpanId);
    }

    window.location.href = `/${project.slug}/messages?${params.toString()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    project?.slug,
    router,
    tracesQuery.status,
    tracesQuery.data?.groups?.length,
  ]);

  useEffect(() => {
    if (!detected) return;
    if (secondsLeft === null) setSecondsLeft(3);
  }, [detected, secondsLeft]);

  useEffect(() => {
    if (!detected || secondsLeft === null) return;
    if (secondsLeft <= 0) {
      goToTraces();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [detected, secondsLeft, goToTraces]);

  return (
    <Box
      position="fixed"
      left="50%"
      bottom="24px"
      transform="translateX(-50%)"
      zIndex={10}
    >
      <Box position="relative" display="inline-block">
        <HStack
          position="relative"
          bg="transparent"
          _before={{
            content: '""',
            position: "absolute",
            inset: 0,
            borderRadius: "full",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.02))",
            pointerEvents: "none",
          }}
          backdropFilter="blur(10px)"
          style={{ WebkitBackdropFilter: "blur(10px)" }}
          borderWidth="1px"
          borderColor="whiteAlpha.200"
          boxShadow="0 4px 18px rgba(2, 1, 1, 0.14), inset 0 1px 0 rgba(255,255,255,0.18)"
          borderRadius="full"
          px={4}
          py={2}
          gap={2}
          overflow="hidden"
          transition="all 0.2s ease"
          aria-live="polite"
        >
          {detected ? (
            <>
              <Box color={success} display="flex" alignItems="center">
                <CheckCircle size={16} />
              </Box>
              <Text fontWeight="medium" fontSize="sm">
                Traces detected —
                {secondsLeft !== null &&
                  secondsLeft > 0 &&
                  ` redirecting in ${secondsLeft}..`}
                {secondsLeft !== null && secondsLeft === 0 && ` redirecting...`}
              </Text>
            </>
          ) : (
            <>
              <Spinner
                color={accent}
                borderWidth="2px"
                animationDuration="2s"
                size="sm"
              />
              <Text fontWeight="medium" fontSize="sm">
                Waiting to receive traces…
              </Text>
            </>
          )}
        </HStack>
      </Box>
    </Box>
  );
}
