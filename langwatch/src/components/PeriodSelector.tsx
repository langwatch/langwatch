import {
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
  format,
  startOfDay,
  subDays,
} from "date-fns";
import { useState } from "react";
import { Calendar } from "react-feather";

export const usePeriodSelector = () => {
  const [startDate, setStartDate] = useState(addDays(new Date(), -14));
  const [endDate, setEndDate] = useState(new Date());
  const daysDifference = differenceInCalendarDays(endDate, startDate) + 1;

  return {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    daysDifference,
  };
};

export function PeriodSelector({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  daysDifference,
}: {
  startDate: Date;
  setStartDate: (date: Date) => void;
  endDate: Date;
  setEndDate: (date: Date) => void;
  daysDifference: number;
}) {
  const { isOpen, onOpen, onClose } = useDisclosure();

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
    setStartDate(newStartDate);
    setEndDate(newEndDate);
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
        <Button variant="outline" onClick={onOpen}>
          <HStack>
            <Calendar size={16} />
            <Text>{getDateRangeLabel()}</Text>
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
                  onChange={(e) => setStartDate(new Date(e.target.value))}
                />
              </FormControl>
              <FormControl>
                <FormLabel>End Date</FormLabel>
                <Input
                  type="date"
                  value={format(endDate, "yyyy-MM-dd")}
                  onChange={(e) => setEndDate(new Date(e.target.value))}
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
