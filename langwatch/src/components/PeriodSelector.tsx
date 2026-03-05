import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { useRouter } from "next/router";
import { useCallback, useMemo } from "react";
import { Calendar, ChevronDown } from "react-feather";
import { LuCalendar } from "react-icons/lu";
import { Popover } from "./ui/popover";

/** Date range used for time-based filtering across the app. */
export type Period = { startDate: Date; endDate: Date };

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
        now.getHours(),
      ),
    [now],
  );

  const startDate = useMemo(
    () =>
      typeof router.query.startDate === "string" &&
      isValidDateString(router.query.startDate)
        ? new Date(router.query.startDate)
        : addDays(thisHour, -(defaultNDays - 1)),
    [defaultNDays, router.query.startDate, thisHour],
  );
  const endDate = useMemo(
    () =>
      typeof router.query.endDate === "string" &&
      isValidDateString(router.query.endDate)
        ? new Date(router.query.endDate)
        : now,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router.query.endDate, thisHour],
  );

  const daysDifference = getDaysDifference(startDate, endDate);

  const setPeriod = useCallback(
    (startDate: Date, endDate: Date) => {
      const validEndDate =
        endDate instanceof Date && !isNaN(endDate.getTime())
          ? endDate
          : new Date();

      const validStartDate =
        startDate instanceof Date && !isNaN(startDate.getTime())
          ? startDate
          : new Date();

      void router.push(
        {
          query: {
            ...router.query,
            startDate: validStartDate.toISOString(),
            endDate: validEndDate.toISOString(),
          },
        },
        undefined,
        { shallow: true },
      );
    },
    [router],
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
  const { open, onOpen, onClose, setOpen } = useDisclosure();

  const daysDifference = getDaysDifference(startDate, endDate);
  const daysDifferenceFromToday = getDaysDifference(endDate, new Date());

  const quickSelectors = [
    { label: "Today", days: 1 },
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
      (selector) =>
        selector.days === daysDifference && daysDifferenceFromToday <= 1,
    );
    return quickSelect
      ? quickSelect.label
      : `${format(new Date(startDate), "MMM d")} - ${format(
          new Date(endDate),
          "MMM d",
        )}`;
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open }) => setOpen(open)}
      positioning={{ placement: "bottom-end" }}
      size="sm"
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          minWidth="fit-content"
          onClick={onOpen}
        >
          <LuCalendar />
          <Text>{getDateRangeLabel()}</Text>
          <Box>
            <ChevronDown />
          </Box>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="fit-content">
        <Popover.Arrow />
        <Popover.CloseTrigger />
        <Popover.Header>
          <Popover.Title>Select Date Range</Popover.Title>
        </Popover.Header>
        <Popover.Body>
          <HStack align="start" gap={6}>
            <VStack gap={4}>
              <Field.Root>
                <Field.Label>Start Date</Field.Label>
                <Input
                  type="datetime-local"
                  value={format(startDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) => setPeriod(new Date(e.target.value), endDate)}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>End Date</Field.Label>
                <Input
                  type="datetime-local"
                  value={format(endDate, "yyyy-MM-dd'T'HH:mm")}
                  onChange={(e) =>
                    setPeriod(startDate, new Date(e.target.value))
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
