import { Box, HStack, Text, VStack, Flex, Spacer, Tooltip } from "@chakra-ui/react";
import type { TraceCheck } from "../server/tracer/types";
import type { CheckTypes } from "../trace_checks/types";

import { CheckCircle, Clock, XCircle } from "react-feather";
import { getTraceCheckDefinitions } from "../trace_checks/registry";
import numeral from "numeral";
import { format, formatDistanceToNow } from "date-fns";


export function CheckPassingDrawer({ check }: { check: TraceCheck }) {
  const checkType = check.check_type as CheckTypes;


  const done =
    check.status === "succeeded" ||
    check.status === "failed" ||
    check.status === "error";
  const checkPasses = check.status === "succeeded";
  const traceCheck = getTraceCheckDefinitions(checkType);


  const timestampDate = check.timestamps.finished_at ? new Date(check.timestamps.finished_at) : undefined;
  const timeAgo = timestampDate
    ? timestampDate.getTime() < Date.now() - 1000 * 60 * 60 * 24
      ? format(timestampDate, "dd/MMM HH:mm")
      : formatDistanceToNow(timestampDate, {
        addSuffix: true,
      })
    : undefined;

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
          {check.timestamps.finished_at && (
            <Tooltip
              label={new Date(check.timestamps.finished_at).toLocaleString()}
            >
              <Text
                borderBottomWidth="1px"
                borderBottomColor="gray.400"
                borderBottomStyle="dashed"
              >
                {formatDistanceToNow(new Date(check.timestamps.finished_at), {
                  addSuffix: true,
                })}
              </Text>
            </Tooltip>
          )}
        </Text>
      </Flex>
    </Box >
  );
}
