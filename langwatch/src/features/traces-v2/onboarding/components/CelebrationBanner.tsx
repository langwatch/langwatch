import { Button, Flex, Icon, Text } from "@chakra-ui/react";
import { PartyPopper } from "lucide-react";

interface CelebrationBannerProps {
  onDismiss: () => void;
}

export const CelebrationBanner = ({ onDismiss }: CelebrationBannerProps) => {
  return (
    <Flex
      align="center"
      justify="center"
      gap={2}
      paddingY={2}
      bg="green.subtle"
      borderBottomWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
    >
      <Icon boxSize={4} color="green.fg">
        <PartyPopper />
      </Icon>
      <Text textStyle="sm" color="green.fg" fontWeight="medium">
        Your first traces are here!
      </Text>
      <Text textStyle="xs" color="green.fg">
        Your integration is working. Traces will appear in real-time.
      </Text>
      <Button
        size="xs"
        variant="ghost"
        colorPalette="green"
        onClick={onDismiss}
        marginLeft={2}
      >
        Dismiss
      </Button>
    </Flex>
  );
};
