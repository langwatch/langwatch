import { Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** One labeled value in a drawer's detail grid. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="start" gap={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text as="div">{children}</Text>
    </VStack>
  );
}

/** A titled, top-bordered group of drawer content. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <VStack
      align="start"
      gap={3}
      width="full"
      borderTopWidth="1px"
      borderColor="border"
      paddingTop={4}
    >
      <Text fontWeight="semibold">{title}</Text>
      {children}
    </VStack>
  );
}
