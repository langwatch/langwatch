import { Box, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { toaster } from "../ui/toaster";

/**
 * A short list of values the customer carries somewhere else — into a DNS
 * control panel, an identity provider's console — drawn as one bordered
 * group of hairline rows rather than a stack of full-width inputs.
 *
 * A read-only value is not a field: it cannot be edited, so an input's
 * affordance is a promise the row does not keep. What a reader does with
 * these is copy them, so the whole row is the copy target and the button
 * restates it for the pointer that wants one.
 */
export function CopyValueRows({
  rows,
}: {
  rows: { label: string; hint?: string; value: string }[];
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      overflow="hidden"
    >
      {rows.map((row, index) => (
        <CopyValueRow
          key={row.label}
          label={row.label}
          hint={row.hint}
          value={row.value}
          first={index === 0}
        />
      ))}
    </Box>
  );
}

function CopyValueRow({
  label,
  hint,
  value,
  first,
}: {
  label: string;
  hint?: string;
  value: string;
  first: boolean;
}) {
  const copy = () => {
    if (!navigator.clipboard) {
      toaster.create({
        title: `Your browser does not support clipboard access, please copy the ${label} manually`,
        type: "error",
        duration: 2000,
      });
      return;
    }
    void navigator.clipboard.writeText(value).then(() => {
      toaster.create({
        title: `${label} copied to your clipboard`,
        type: "success",
        duration: 2000,
      });
    });
  };

  return (
    <HStack
      gap={3}
      paddingX={3.5}
      paddingY={2.5}
      borderTopWidth={first ? 0 : "1px"}
      borderColor="border.muted"
      cursor="pointer"
      _hover={{ backgroundColor: "bg.subtle" }}
      onClick={copy}
    >
      <VStack align="stretch" gap={0.5} minWidth={0} flex="1">
        <HStack gap={2}>
          <Text fontSize="sm" fontWeight="medium">
            {label}
          </Text>
          {hint && (
            <Text fontSize="xs" color="fg.muted">
              {hint}
            </Text>
          )}
        </HStack>
        <Text
          fontFamily="mono"
          fontSize="xs"
          color="fg.muted"
          truncate
          title={value}
        >
          {value}
        </Text>
      </VStack>
      <IconButton
        aria-label={`Copy ${label}`}
        size="xs"
        variant="ghost"
        flexShrink={0}
        onClick={(event) => {
          event.stopPropagation();
          copy();
        }}
      >
        <Copy size={14} />
      </IconButton>
    </HStack>
  );
}
