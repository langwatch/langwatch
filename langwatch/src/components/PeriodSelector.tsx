import {
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { useRouter } from "next/router";
import { useCallback, useMemo } from "react";
import { Calendar, ChevronDown } from "react-feather";
import { Popover } from "./ui/popover";

const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

const isValidDateString = (dateString: string) => {
  const d = new Date(dateString);
  return d instanceof Date && !isNaN(d as any);
};

export const usePeriodSelector = (defaultNDays = 30) => {
  const router = useRouter();

  const now = useMemo(() => new Date(), []);
  const thisHour = useMemo(
    () =>
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours()
      ),
    [now]
  );

  const startDate = useMemo(
    () =>
      typeof router.query.startDate === "string" &&
      isValidDateString(router.query.startDate)
        ? new Date(router.query.startDate)
        : addDays(thisHour, -(defaultNDays - 1)),
    [defaultNDays, router.query.startDate, thisHour]
  );
  const endDate = useMemo(
    () =>
      typeof router.query.endDate === "string" &&
      isValidDateString(router.query.endDate)
        ? new Date(router.query.endDate)
        : now,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router.query.endDate, thisHour]
  );

  const daysDifference = getDaysDifference(startDate, endDate);

  const setPeriod = useCallback(
    (startDate: Date, endDate: Date) => {
      void router.push(
        {
          query: {
            ...router.query,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
        },
        undefined,
        { shallow: true }
      );
    },
    [router]
  );

  return {
    period: { startDate, endDate },
    setPeriod,
    daysDifference,
  };
};

export function PeriodSelector({
  period: { startDate, endDate },
  setPeriod,
}: {
  period: {
    startDate: Date;
    endDate: Date;
  };
  setPeriod: (startDate: Date, endDate: Date) => void;
}) {
  const { open, onOpen, setOpen } = useDisclosure();

  const daysDifference = getDaysDifference(startDate, endDate);

  const quickSelectors = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 15 days", days: 15 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 90 days", days: 90 },
    { label: "Last 6 months", days: 180 },
    { label: "Last 1 year", days: 365 },
  ];

  const handleQuickSelect = (days: number) => {
    const newEndDate = new Date();
    const newStartDate = startOfDay(subDays(newEndDate, days - 1));
    setPeriod(newStartDate, newEndDate);
    onClose();
  };

  const getDateRangeLabel = () => {
    const quickSelect = quickSelectors.find(
      (selector) => selector.days === daysDifference
    );
    return quickSelect
      ? quickSelect.label
      : `${format(new Date(startDate), "MMM d")} - ${format(
          new Date(endDate),
          "MMM d"
        )}`;
  };

  return (
    <Popover.Root positioning={{ placement: "bottom-end" }}>
      <Popover.Trigger asChild>
        <Button variant="outline" minWidth="fit-content" onClick={onOpen}>
          <HStack gap={2}>
            <Calendar size={16} />
            <Text>{getDateRangeLabel()}</Text>
            <Box>
              <ChevronDown width={14} />
            </Box>
          </HStack>
        </Button>
      </Popover.Trigger>
      <Popover.Content>
        <Popover.Arrow />
        <Popover.CloseTrigger />
        <Popover.Header>
          <Heading size="sm">Select Date Range</Heading>
        </Popover.Header>
        <Popover.Body padding={4}>
          <HStack align="start" gap={6}>
            <VStack gap={4}>
              <Field.Root>
                <Field.Label>Start Date</Field.Label>
                <Input
                  type="date"
                  value={format(startDate, "yyyy-MM-dd")}
                  onChange={(e) =>
                    setPeriod(
                      startOfDay(new Date(e.target.value + "T00:00:00")),
                      endDate
                    )
                  }
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>End Date</Field.Label>
                <Input
                  type="date"
                  value={format(endDate, "yyyy-MM-dd")}
                  onChange={(e) =>
                    setPeriod(
                      startDate,
                      endOfDay(new Date(e.target.value + "T00:00:00"))
                    )
                  }
                />
              </Field.Root>
            </VStack>
            <VStack>
              {quickSelectors.map((selector) => (
                <Button
                  width="full"
                  key={selector.label}
                  onClick={() => handleQuickSelect(selector.days)}
                >
                  {selector.label}
                </Button>
              ))}
            </VStack>
          </HStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
