import { Box } from "@chakra-ui/react";
import React, { useEffect, useRef, useState } from "react";
import { Tooltip } from "./ui/tooltip";

export function OverflownTextWithTooltip({
  children,
  ...props
}: React.PropsWithChildren<React.ComponentProps<typeof Box>>) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);

  useEffect(() => {
    const element = ref.current!;
    setIsOverflown(element.scrollHeight > element.clientHeight);
  }, []);

  return (
    <Tooltip
      content={children}
      disabled={!isOverflown}
      positioning={{ placement: "top" }}
    >
      <Box ref={ref} {...props}>
        {children}
      </Box>
    </Tooltip>
  );
}
