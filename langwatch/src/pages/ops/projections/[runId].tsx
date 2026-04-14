import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  HStack,
  Progress,
  Spinner,
  Status,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { api } from "~/utils/api";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { Link } from "~/components/ui/link";

// -- Cowboy Gunfight Frames (adapted from CLI) --
// Positions: Left figure at col 5, Right figure at col 33
// Each frame is 3 lines of monospace text

function buildFrames(): string[][] {
  const pad = (col: number, text: string, current: number): string => {
    if (col > current) return " ".repeat(col - current) + text;
    return text;
  };

  const line = (...segments: [number, string][]): string => {
    let out = "";
    let col = 0;
    for (const [targetCol, text] of segments) {
      if (targetCol > col) out += " ".repeat(targetCol - col);
      out += text;
      col = targetCol + text.length;
    }
    return out;
  };

  const L = 5;
  const R = 33;
  const lStand = "/|\\";
  const rStand = "/|\\";
  const lLegs = "/ \\";
  const rLegs = "/ \\";
  const lGun = "/|\u2550=";
  const rGun = "=\u2550|\\";
  const dots = "\u00B7   \u00B7   \u00B7   \u00B7";
  const bullet = (n: number) => "\u2500".repeat(n);

  return [
    [
      // 0: Standoff
      line([L, "O"], [13, dots], [R, "O"]),
      line([L - 1, lStand], [R - 1, rStand]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 1: Tumbleweed
      line([L, "O"], [R, "O"]),
      line([L - 1, lStand], [18, "\u00B0"], [R - 1, rStand]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 2: Left draws
      line([L, "O"], [R, "O"]),
      line([L - 1, lGun], [13, dots], [R - 1, rStand]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 3: Left shoots
      line([L, "O"], [R, "O"]),
      line(
        [L - 1, lGun],
        [L + 3, bullet(11) + "\u25B6"],
        [R - 1, rStand],
      ),
      line([L - 1, lLegs], [15, "pew!"], [R - 1, rLegs]),
    ],
    [
      // 4: Bullet hits right
      line([L, "O"], [R - 1, "*"], [R, "O"]),
      line(
        [L - 1, lGun],
        [L + 3, "\u00B7 \u00B7 \u00B7 \u00B7 \u00B7"],
        [R - 1, rStand],
      ),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 5: Right dodges
      line([L, "O"], [R - 1, "\\O"]),
      line(
        [L - 1, lGun],
        [L + 3, "\u00B7   \u00B7   \u00B7"],
        [R, "|"],
      ),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 6: Right draws
      line([L, "O"], [R, "O"]),
      line([L - 1, lStand], [13, dots], [R - 2, rGun]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 7: Right shoots
      line([L, "O"], [R, "O"]),
      line(
        [L - 1, lStand],
        [L + 2, "\u25C0" + bullet(11)],
        [R - 2, rGun],
      ),
      line([L - 1, lLegs], [20, "!wep"], [R - 1, rLegs]),
    ],
    [
      // 8: Bullet hits left
      line([L + 1, "*"], [L, "O"], [R, "O"]),
      line(
        [L - 1, lStand],
        [L + 2, "\u00B7 \u00B7 \u00B7 \u00B7 \u00B7"],
        [R - 2, rGun],
      ),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 9: Left dodges
      line([L, "O/"], [R, "O"]),
      line([L, "|"], [L + 2, "\u00B7   \u00B7   \u00B7"], [R - 2, rGun]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 10: Both draw
      line([L, "O"], [19, "\u00B7"], [R, "O"]),
      line([L - 1, lGun], [13, dots], [R - 2, rGun]),
      line([L - 1, lLegs], [R - 1, rLegs]),
    ],
    [
      // 11: Both shoot
      line([L, "O"], [R, "O"]),
      line(
        [L - 1, lGun],
        [L + 3, bullet(4) + "\u25B6"],
        [18, "\u2736"],
        [20, "\u25C0" + bullet(4)],
        [R - 2, rGun],
      ),
      line([L - 1, lLegs], [13, "pew! !wep"], [R - 1, rLegs]),
    ],
    [
      // 12: Explosion
      line([L, "O"], [15, "\\"], [17, "*"], [19, "|"], [21, "*"], [23, "/"], [R, "O"]),
      line(
        [L - 1, lGun],
        [13, bullet(2)],
        [16, "\u2605"],
        [18, "\u2605"],
        [20, "\u2605"],
        [23, bullet(2)],
        [R - 2, rGun],
      ),
      line(
        [L - 1, lLegs],
        [15, "/"],
        [17, "*"],
        [19, "|"],
        [21, "*"],
        [23, "\\"],
        [R - 1, rLegs],
      ),
    ],
    [
      // 13: Smoke
      line([L, "O"], [12, "~  ~  ~  ~  ~"], [R, "O"]),
      line([L - 1, lStand], [11, "~  ~  ~  ~  ~  ~"], [R - 1, rStand]),
      line([L - 1, lLegs], [12, "~  ~  ~  ~  ~"], [R - 1, rLegs]),
    ],
  ];
}

const FRAMES = buildFrames();

function getFrameForPhase(
  phase: string | null,
  tick: number,
): string[] {
  if (phase === "replay") {
    const seq = [3, 4, 5, 6, 7, 8, 9, 10, 11];
    const idx = Math.floor(tick / 3) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  if (phase === "write") {
    const seq = [11, 12, 12, 13, 13];
    const idx = Math.floor(tick / 3) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  if (phase === "drain") {
    const seq = [0, 0, 1, 0, 0];
    const idx = Math.floor(tick / 4) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  if (phase === "cutoff") {
    const seq = [0, 2, 6, 10];
    const idx = Math.floor(tick / 4) % seq.length;
    return FRAMES[seq[idx]!]!;
  }
  // Default: calm standoff
  return FRAMES[0]!;
}

function CowboyAnimation({ phase }: { phase: string | null }) {
  const [tick, setTick] = useState(0);
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const frame = getFrameForPhase(phase, tick);

  return (
    <Box
      fontFamily="mono"
      fontSize="14px"
      lineHeight="1.3"
      whiteSpace="pre"
      textAlign="center"
      color="orange.400"
      userSelect="none"
    >
      {frame.map((line, i) => (
        <Box key={i}>{line}</Box>
      ))}
    </Box>
  );
}

function formatDuration(startedAt: string): string {
  const seconds = (Date.now() - new Date(startedAt).getTime()) / 1000;
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h${remainMins}m${secs}s`;
}

export default function ReplayProgressPage() {
  const router = useRouter();
  const runId = router.query.runId as string;

  const { hasAccess, isLoading: opsLoading, scope } = useOpsPermission();

  useEffect(() => {
    if (!opsLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, opsLoading, router]);

  const statusQuery = api.ops.getReplayStatus.useQuery(undefined, {
    refetchInterval: 1500,
  });
  const cancelMutation = api.ops.cancelReplay.useMutation({
    onSuccess: () => {
      void statusQuery.refetch();
    },
  });
  const canManage =
    scope?.kind === "platform" || scope?.kind === "organization";

  const status = statusQuery.data;
  const isRunning = status?.state === "running";
  const isThisRun = status?.runId === runId;

  const progressPercent =
    status && status.aggregatesTotal > 0
      ? Math.round(
          (status.aggregatesProcessed / status.aggregatesTotal) * 100,
        )
      : 0;

  const stateColor =
    status?.state === "completed"
      ? "green"
      : status?.state === "failed"
        ? "red"
        : status?.state === "cancelled"
          ? "orange"
          : "blue";

  const meshGradientStyle =
    isRunning && isThisRun
      ? {
          background:
            "linear-gradient(135deg, rgba(251,146,60,0.05) 0%, rgba(251,146,60,0.12) 25%, rgba(234,88,12,0.08) 50%, rgba(251,146,60,0.12) 75%, rgba(251,146,60,0.05) 100%)",
          backgroundSize: "200% 200%",
          animation: "meshPulse 4s ease infinite",
        }
      : {};

  if (opsLoading || !hasAccess) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Replay Progress</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
      <style>{`
        @keyframes meshPulse {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>

      <Box style={meshGradientStyle} borderRadius="lg" padding={4}>
        <HStack marginBottom={4}>
          <Link href="/ops/projections" _hover={{ textDecoration: "none" }}>
            <HStack gap={1} color="fg.muted" _hover={{ color: "fg" }}>
              <ArrowLeft size={14} />
              <Text textStyle="xs">Back to Projections</Text>
            </HStack>
          </Link>
        </HStack>

        {statusQuery.isLoading && (
          <Center paddingY={20}>
            <Spinner size="lg" />
          </Center>
        )}

        {status && !isThisRun && status.state === "idle" && (
          <Center paddingY={20}>
            <VStack gap={2}>
              <Text textStyle="sm" color="fg.muted">
                No active replay found for this run ID.
              </Text>
              <Link href="/ops/projections">
                <Button size="sm" variant="outline">
                  Back to Projections
                </Button>
              </Link>
            </VStack>
          </Center>
        )}

        {status && (isThisRun || status.state !== "idle") && (
          <VStack align="stretch" gap={4}>
            {/* Cowboys animation */}
            <Card.Root overflow="hidden">
              <Card.Body padding={6}>
                <Center>
                  <CowboyAnimation
                    phase={isRunning ? status.currentPhase : null}
                  />
                </Center>
              </Card.Body>
            </Card.Root>

            {/* Status card */}
            <Card.Root>
              <Card.Body padding={4}>
                <VStack align="stretch" gap={3}>
                  <HStack justify="space-between">
                    <HStack gap={2}>
                      <Status.Root colorPalette={stateColor}>
                        <Status.Indicator />
                      </Status.Root>
                      <Text textStyle="sm" fontWeight="semibold">
                        Replay{" "}
                        {status.state === "running"
                          ? "in progress"
                          : status.state}
                      </Text>
                      {status.currentProjection && isRunning && (
                        <Badge size="sm" variant="subtle">
                          {status.currentProjection}
                        </Badge>
                      )}
                      {status.currentPhase && isRunning && (
                        <Badge
                          size="sm"
                          variant="outline"
                          colorPalette="orange"
                        >
                          {status.currentPhase}
                        </Badge>
                      )}
                    </HStack>
                    {isRunning && canManage && (
                      <Button
                        size="xs"
                        colorPalette="red"
                        variant="outline"
                        loading={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate()}
                      >
                        Cancel Replay
                      </Button>
                    )}
                  </HStack>

                  {status.description && (
                    <Text textStyle="xs" color="fg.muted">
                      {status.description}
                    </Text>
                  )}

                  {isRunning && (
                    <VStack align="stretch" gap={1}>
                      <Progress.Root
                        size="sm"
                        value={progressPercent}
                        colorPalette="orange"
                      >
                        <Progress.Track>
                          <Progress.Range />
                        </Progress.Track>
                      </Progress.Root>
                      <HStack justify="space-between">
                        <Text textStyle="xs" color="fg.muted">
                          {status.aggregatesProcessed} /{" "}
                          {status.aggregatesTotal} aggregates (
                          {progressPercent}%)
                        </Text>
                        <Text textStyle="xs" color="fg.muted">
                          {status.eventsProcessed.toLocaleString()}{" "}
                          events
                        </Text>
                      </HStack>
                    </VStack>
                  )}

                  {status.state === "completed" && (
                    <HStack gap={4} flexWrap="wrap">
                      <Text textStyle="xs" color="fg.muted">
                        {status.aggregatesProcessed} aggregates
                        replayed
                      </Text>
                      <Text textStyle="xs" color="fg.muted">
                        {status.eventsProcessed.toLocaleString()} events
                        processed
                      </Text>
                      {status.completedAt && (
                        <Text textStyle="xs" color="fg.muted">
                          Completed at{" "}
                          {new Date(
                            status.completedAt,
                          ).toLocaleString()}
                        </Text>
                      )}
                    </HStack>
                  )}

                  {status.state === "failed" && status.error && (
                    <Box
                      bg="red.subtle"
                      padding={3}
                      borderRadius="md"
                    >
                      <Text textStyle="xs" color="red.500">
                        {status.error}
                      </Text>
                    </Box>
                  )}

                  {status.startedAt && (
                    <Text textStyle="xs" color="fg.muted">
                      Duration: {formatDuration(status.startedAt)}
                      {status.userName && ` | Started by ${status.userName}`}
                    </Text>
                  )}

                  <HStack gap={2} flexWrap="wrap">
                    {status.projectionNames.map((name) => (
                      <Badge key={name} size="sm" variant="subtle">
                        {name}
                      </Badge>
                    ))}
                  </HStack>
                </VStack>
              </Card.Body>
            </Card.Root>
          </VStack>
        )}
      </Box>
      </PageLayout.Container>
    </DashboardLayout>
  );
}
