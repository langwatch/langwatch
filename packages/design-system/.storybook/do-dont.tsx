import { Badge, Box, Code, Grid, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** One side of a do and don't pair: the verdict, the rendered result, the code that made it. */
function Side({
  verdict,
  code,
  children,
}: {
  verdict: "do" | "dont";
  code: string;
  children: ReactNode;
}) {
  const isDo = verdict === "do";
  return (
    <Stack gap={2} minWidth={0}>
      <Badge alignSelf="start" colorPalette={isDo ? "green" : "red"} variant="subtle">
        {isDo ? "Do" : "Don't"}
      </Badge>
      <Box
        padding={4}
        borderRadius="md"
        borderWidth="1px"
        borderColor={isDo ? "border.success" : "border.error"}
        bg="bg.panel"
      >
        {children}
      </Box>
      <Code display="block" whiteSpace="pre-wrap" padding={2} fontSize="xs">
        {code}
      </Code>
    </Stack>
  );
}

export function DoDont({
  why,
  dont,
  dontCode,
  doThis,
  doCode,
}: {
  why: string;
  dont: ReactNode;
  dontCode: string;
  doThis: ReactNode;
  doCode: string;
}) {
  return (
    <Stack gap={3}>
      <Text color="fg.muted">{why}</Text>
      <Grid templateColumns="repeat(auto-fit, minmax(18rem, 1fr))" gap={4}>
        <Side verdict="dont" code={dontCode}>
          {dont}
        </Side>
        <Side verdict="do" code={doCode}>
          {doThis}
        </Side>
      </Grid>
    </Stack>
  );
}
