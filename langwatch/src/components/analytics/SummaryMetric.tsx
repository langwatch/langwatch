import { Box, Heading, Skeleton, Tooltip, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { HelpCircle } from "react-feather";

export function SummaryMetric({
  label,
  current,
  previous,
  format,
  tooltip,
}: {
  label: string;
  current?: number | string;
  previous?: number;
  format?: ((value: number) => string) | ((value: string) => string) | string;
  tooltip?: string;
}) {
  return (
    <VStack
      maxWidth="180"
      spacing={4}
      align="start"
      justifyContent="space-between"
      borderLeftWidth="1px"
      borderLeftColor="gray.300"
      paddingX={4}
      _first={{ paddingLeft: 0, borderLeft: "none" }}
    >
      <Heading
        fontSize="13"
        color="gray.500"
        fontWeight="normal"
        lineHeight="1.5em"
      >
        {label}
        {tooltip && (
          <Tooltip label={tooltip}>
            <HelpCircle
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                marginTop: "-3px",
                marginLeft: "4px",
              }}
              width="14px"
            />
          </Tooltip>
        )}
      </Heading>
      <Box fontSize="28" fontWeight="600">
        {current !== undefined ? (
          typeof format === "function" ? (
            //@ts-ignore
            format(current)
          ) : (
            numeral(current).format(format ?? "0a")
          )
        ) : (
          <Box paddingY="0.25em">
            <Skeleton height="1em" width="80px" />
          </Box>
        )}
      </Box>
    </VStack>
  );
}
