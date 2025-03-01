import { Box, type BoxProps } from "@chakra-ui/react";
import React, { useEffect, useRef, useState } from "react";
import { Tooltip } from "./ui/tooltip";

export function OverflownTextWithTooltip({
  children,
  ...props
}: Omit<BoxProps, "label"> & {
  label?: React.ReactNode | string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    setIsOverflown(element.scrollHeight > element.clientHeight);
  }, []);

  return (
    <Tooltip
      content={props.label ?? children}
      disabled={!isOverflown}
      positioning={{ placement: "top" }}
    >
      <Box ref={ref} lineClamp={props.lineClamp ?? 1} {...(props as BoxProps)}>
        {children}
      </Box>
    </Tooltip>
  );
}
