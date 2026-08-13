import { Box, Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { RotateCcw } from "lucide-react";
import { ProcessesContent } from "~/components/ops/processes/ProcessesContent";
import { SubscribersCard } from "~/components/ops/processes/SubscribersCard";
import { SchedulerContent } from "~/components/ops/scheduler/SchedulerContent";
import { useDrawer } from "~/hooks/useDrawer";
import { ProjectionsCard } from "./ProjectionsCard";

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <HStack justify="space-between" align="start">
        <Box>
          <Heading size="sm">{title}</Heading>
          <Text textStyle="xs" color="fg.muted" marginBottom={3}>
            {description}
          </Text>
        </Box>
        {action}
      </HStack>
      {children}
    </Box>
  );
}

/**
 * The event-sourcing substrate on one page, ordered by how an event flows:
 * projections build the read models, subscribers fire the side effects,
 * processes run the durable state machines, and schedules feed the
 * time-driven work in. Each section is registry-driven, so a consumer with
 * no live jobs is still on the page.
 */
export function EventSourcingContent() {
  const { openDrawer } = useDrawer();
  return (
    <VStack align="stretch" gap={8}>
      <Section
        title="Projections"
        description="Read models built from events. Rebuild any of them with a replay."
        action={
          <Button
            size="xs"
            variant="outline"
            onClick={() => openDrawer("opsReplay", {})}
          >
            <RotateCcw size={12} />
            Replay projections
          </Button>
        }
      >
        <ProjectionsCard />
      </Section>
      <Section
        title="Event Subscribers"
        description="Side-effect handlers triggered by events, with their live queue health."
      >
        <SubscribersCard />
      </Section>
      <Section
        title="Processes"
        description="Durable state machines with wakes and a transactional outbox."
      >
        <ProcessesContent />
      </Section>
      <Section
        title="Schedules"
        description="Time-driven work across every project: what runs next, and what is behind."
      >
        <SchedulerContent />
      </Section>
    </VStack>
  );
}
