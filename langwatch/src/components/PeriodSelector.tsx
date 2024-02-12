import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
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
        : thisHour,
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
  const { isOpen, onOpen, onClose } = useDisclosure();

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
    <Popover isOpen={isOpen} onClose={onClose} placement="bottom-end">
      <PopoverTrigger>
        <Button variant="outline" onClick={onOpen} minWidth="fit-content">
          <HStack spacing={2}>
            <Calendar size={16} />
            <Text>{getDateRangeLabel()}</Text>
            <Box>
              <ChevronDown width={14} />
            </Box>
          </HStack>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="fit-content">
        <PopoverArrow />
        <PopoverCloseButton />
        <PopoverHeader>
          <Heading size="sm">Select Date Range</Heading>
        </PopoverHeader>
        <PopoverBody padding={4}>
          <HStack align="start" spacing={6}>
            <VStack spacing={4}>
              <FormControl>
                <FormLabel>Start Date</FormLabel>
                <Input
                  type="date"
                  value={format(startDate, "yyyy-MM-dd")}
                  onChange={(e) => setPeriod(new Date(e.target.value), endDate)}
                />
              </FormControl>
              <FormControl>
                <FormLabel>End Date</FormLabel>
                <Input
                  type="date"
                  value={format(endDate, "yyyy-MM-dd")}
                  onChange={(e) =>
                    setPeriod(startDate, endOfDay(new Date(e.target.value)))
                  }
                />
              </FormControl>
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
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
