import {
  Box,
  HStack,
  LinkOverlay,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Portal,
  Skeleton,
  Spacer,
  Tag,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import numeral from "numeral";
import { CheckCircle, Clock, HelpCircle, XCircle } from "react-feather";
import Markdown from "react-markdown";
import {
  getSlicedInput,
  getSlicedOutput,
  getTotalTokensDisplay,
} from "../mappers/trace";
import type { Trace, TraceCheck } from "../server/tracer/types";
import { formatMilliseconds } from "../utils/formatMilliseconds";
import { CheckPassing } from "./CheckPassing";
import type { Project } from "@prisma/client";
import NextLink from "next/link";
import type { ColorMap } from "../utils/rotatingColors";

export function MessageCard({
  linkActive,
  project,
  trace,
  checksMap,
  colorMap,
}: {
  linkActive: boolean;
  project: Project;
  trace: Trace;
  checksMap: Record<string, TraceCheck[]> | undefined;
  colorMap: ColorMap;
}) {
  const traceChecks = checksMap ? checksMap[trace.id] ?? [] : [];
  const checksDone = traceChecks.every(
    (check) =>
      check.status == "succeeded" ||
      check.status == "failed" ||
      check.status == "error"
  );
  const checkPasses = traceChecks.filter(
    (check) => check.status == "succeeded"
  ).length;
  const totalChecks = traceChecks.length;
  const topics =
    (typeof trace.topics == "string" ? [trace.topics] : trace.topics) ?? [];

  return (
    <VStack alignItems="flex-start" spacing={4} width="fill">
      <VStack alignItems="flex-start" spacing={8}>
        <VStack alignItems="flex-start" spacing={2}>
          <Box
            fontSize={11}
            color="gray.400"
            textTransform="uppercase"
            fontWeight="bold"
          >
            Input
          </Box>
          <Box fontWeight="bold">
            <LinkOverlay
              as={NextLink}
              href={`/${project.slug}/messages/${trace.id}/spans`}
              onClick={(e) => {
                if (!linkActive) e.preventDefault();
              }}
            >
              {getSlicedInput(trace)}
            </LinkOverlay>
          </Box>
        </VStack>
        {trace.error && !trace.output?.value ? (
          <VStack alignItems="flex-start" spacing={2}>
            <Box
              fontSize={11}
              color="red.400"
              textTransform="uppercase"
              fontWeight="bold"
            >
              Exception
            </Box>
            <Text color="red.900">{trace.error.message}</Text>
          </VStack>
        ) : (
          <VStack alignItems="flex-start" spacing={2}>
            <Box
              fontSize={11}
              color="gray.400"
              textTransform="uppercase"
              fontWeight="bold"
            >
              Generated
            </Box>
            <Box>
              {trace.output?.value ? (
                <Markdown className="markdown">
                  {getSlicedOutput(trace)}
                </Markdown>
              ) : (
                <Text>{"<empty>"}</Text>
              )}
            </Box>
          </VStack>
        )}
      </VStack>
      <Spacer />
      <HStack width="full" alignItems="flex-end">
        <VStack gap={4} alignItems="flex-start">
          <HStack spacing={2}>
            {/* TODO: loop over models used */}
            {/* <Tag background="blue.50" color="blue.600">
                    vendor/model
                  </Tag> */}
            {topics.map((topic) => (
              <Tag
                key={topic}
                background={colorMap[topic]?.background}
                color={colorMap[topic]?.color}
                fontSize={12}
              >
                {topic}
              </Tag>
            ))}
          </HStack>
          <HStack fontSize={12} color="gray.400">
            <Tooltip
              label={new Date(trace.timestamps.started_at).toLocaleString()}
            >
              <Text
                borderBottomWidth="1px"
                borderBottomColor="gray.400"
                borderBottomStyle="dashed"
              >
                {formatDistanceToNow(new Date(trace.timestamps.started_at), {
                  addSuffix: true,
                })}
              </Text>
            </Tooltip>
            {(!!trace.metrics.completion_tokens ||
              !!trace.metrics.prompt_tokens) && (
              <>
                <Text>·</Text>
                <HStack>
                  <Box>{getTotalTokensDisplay(trace)}</Box>
                  {trace.metrics.tokens_estimated && (
                    <Tooltip label="token count is calculated by LangWatch when not available from the trace data">
                      <HelpCircle width="14px" />
                    </Tooltip>
                  )}
                </HStack>
              </>
            )}
            {!!trace.metrics.total_cost && (
              <>
                <Text>·</Text>
                <Box>
                  {trace.metrics.total_cost > 0.01
                    ? numeral(trace.metrics.total_cost).format("$0.00a")
                    : "< $0.01"}{" "}
                  cost
                </Box>
              </>
            )}
            {!!trace.metrics.first_token_ms && (
              <>
                <Text>·</Text>
                <Box>
                  {formatMilliseconds(trace.metrics.first_token_ms)} to first
                  token
                </Box>
              </>
            )}
            {!!trace.metrics.total_time_ms && (
              <>
                <Text>·</Text>
                <Box>
                  {formatMilliseconds(trace.metrics.total_time_ms)} completion
                  time
                </Box>
              </>
            )}
            {!!trace.error && trace.output?.value && (
              <>
                <Text>·</Text>
                <HStack>
                  <Box
                    width={2}
                    height={2}
                    background="red.400"
                    borderRadius="100%"
                  ></Box>
                  <Text>Exception ocurred</Text>
                </HStack>
              </>
            )}
          </HStack>
        </VStack>
        <Spacer />
        {!checksMap && <Skeleton width={100} height="1em" />}
        {checksMap && totalChecks > 0 && (
          <Popover trigger="hover">
            <PopoverTrigger>
              <Tag
                variant="outline"
                boxShadow="#DEDEDE 0px 0px 0px 1px inset"
                color={
                  !checksDone
                    ? "yellow.600"
                    : checkPasses == totalChecks
                    ? "green.600"
                    : "red.600"
                }
                paddingY={1}
                paddingX={2}
                position="relative"
                zIndex="popover"
              >
                <Box paddingRight={2}>
                  {!checksDone ? (
                    <Clock />
                  ) : checkPasses == totalChecks ? (
                    <CheckCircle />
                  ) : (
                    <XCircle />
                  )}
                </Box>
                {checkPasses}/{totalChecks} checks
              </Tag>
            </PopoverTrigger>
            <Portal>
              <Box zIndex="popover">
                <PopoverContent zIndex={2} width="fit-content">
                  <PopoverArrow />
                  <PopoverHeader>Trace Checks</PopoverHeader>
                  <PopoverBody>
                    <VStack align="start" spacing={2}>
                      {traceChecks.map((check) => (
                        <CheckPassing key={check.id} check={check} />
                      ))}
                    </VStack>
                  </PopoverBody>
                </PopoverContent>
              </Box>
            </Portal>
          </Popover>
        )}
      </HStack>
    </VStack>
  );
}
