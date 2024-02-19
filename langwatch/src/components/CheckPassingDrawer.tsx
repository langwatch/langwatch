import { Box, HStack, Text, VStack, Flex, Spacer } from "@chakra-ui/react";
import type { TraceCheck } from "../server/tracer/types";
import type { CheckTypes, TraceCheckDefinition } from "../trace_checks/types";

import { CheckCircle, Clock, XCircle } from "react-feather";
import { getTraceCheckDefinitions } from "../trace_checks/registry";
import numeral from "numeral";
import { ca } from "date-fns/locale";


export function CheckPassingDrawer({ check }: { check: TraceCheck }) {
  const checkType = check.check_type as CheckTypes;


  const done =
    check.status === "succeeded" ||
    check.status === "failed" ||
    check.status === "error";
  const checkPasses = check.status === "succeeded";
  const traceCheck = getTraceCheckDefinitions(checkType);


  const timeResult = () => {

    let finished_at = check.timestamps.finished_at ?? 0;
    let current_time = new Date().getTime();
    let time_difference = current_time - finished_at;
    let minutes = Math.floor(time_difference / (1000 * 60)); // Convert milliseconds to minutes
    let hours = Math.floor(minutes / 60); // Convert minutes to hours
    let days = Math.floor(hours / 24); // Convert hours to days

    // Remaining minutes and hours after converting to days
    minutes = minutes % 60; // Remaining minutes after converting to hours
    hours = hours % 24; // Remaining hours after converting to days

    // Return the result
    return `${days} days ${hours} hours ${minutes} minutes`;

  }

  const color = check.status === 'succeeded' ? "green.500" : "red.500";


  if (!traceCheck) return null;

  return (
    <Box backgroundColor={'gray.100'} width={'full'} padding={6} borderRadius={'lg'}>
      <Flex>
        <HStack align="start" spacing={1}>
          <Box
            paddingRight={2}
            color={!done ? "yellow.600" : checkPasses ? "green.600" : "red.600"}
          >
            {!done /* TODO: differentiate in_progress and scheduled, also on the general one in Messages */ ? (
              <Clock />
            ) : checkPasses ? (
              <CheckCircle />
            ) : (
              <XCircle />
            )}
          </Box>
          <VStack alignItems="start" spacing={1} >
            <Text >
              <b>{check.check_name || traceCheck.name}</b>
            </Text>
            <Text fontSize={'sm'}>
              {traceCheck.description}
            </Text>
            <Text fontSize={'sm'}>
              {check.status == "succeeded" || check.status == "failed" ? (
                <>

                  {traceCheck.valueDisplayType === "boolean" ?
                    <HStack><Text>Result:</Text> <Text color={color}>{check.status == 'succeeded' ? 'Pass' : 'Fail'}</Text></HStack> :
                    <HStack><Text>Score:</Text> <Text color={color}>{numeral(check.value).format("0.00")}</Text></HStack>
                  }

                </>
              ) : check.status == "error" ? (
                <Text>Error</Text>
              ) : check.status == "in_progress" ? (
                <Text>Processing</Text>
              ) : check.status === "scheduled" ? (
                <Text>Scheduled</Text>
              ) : (
                <Text>unknown</Text>
              )}
            </Text>
          </VStack>

        </HStack>
        <Spacer />
        <Text fontSize={'sm'}>
          {timeResult()} ago
        </Text>
      </Flex>
    </Box >
  );
}
