import { Box, Button, Text, Textarea, VStack } from "@chakra-ui/react";

interface NoLicenseCardProps {
  licenseKey: string;
  onLicenseKeyChange: (value: string) => void;
  onActivate: () => void;
  isActivating: boolean;
}

export function NoLicenseCard({
  licenseKey,
  onLicenseKeyChange,
  onActivate,
  isActivating,
}: NoLicenseCardProps) {
  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      padding={6}
      width="full"
      maxWidth="600px"
    >
      <VStack align="start" gap={4}>
        <VStack align="start" gap={1}>
          <Text fontWeight="medium" fontSize="md">
            No license installed
          </Text>
          <Text color="gray.500" fontSize="sm">
            Running without a license. Some feature may be limited.
          </Text>
        </VStack>

        <VStack align="start" gap={2} width="full">
          <Text fontSize="sm" fontWeight="medium">
            Activate a license:
          </Text>
          <Textarea
            value={licenseKey}
            onChange={(e) => onLicenseKeyChange(e.target.value)}
            placeholder="Paste your license key here..."
            size="sm"
            rows={4}
            fontFamily="mono"
            fontSize="xs"
          />
          <Button
            colorScheme="blue"
            size="sm"
            onClick={onActivate}
            loading={isActivating}
            disabled={!licenseKey.trim() || isActivating}
          >
            Activate License
          </Button>
        </VStack>
      </VStack>
    </Box>
  );
}
