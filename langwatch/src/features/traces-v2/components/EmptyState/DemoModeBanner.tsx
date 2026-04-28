import { Button, Flex, Icon, Text } from "@chakra-ui/react";
import { X } from "lucide-react";

interface DemoModeBannerProps {
  onExit: () => void;
}

export const DemoModeBanner = ({ onExit }: DemoModeBannerProps) => {
  return (
    <Flex
      align="center"
      justify="center"
      gap={2}
      paddingY={1.5}
      bg="yellow.subtle"
      borderBottomWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
    >
      <Text textStyle="xs" color="yellow.fg" fontWeight="medium">
        Viewing sample data
      </Text>
      <Button size="xs" variant="ghost" colorPalette="yellow" onClick={onExit}>
        Exit demo
        <Icon boxSize={3}>
          <X />
        </Icon>
      </Button>
    </Flex>
  );
};
