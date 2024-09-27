import { Box, Tooltip, type BoxProps } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

export function HoverableBigText({ children, ...props }: BoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflown, setIsOverflown] = useState(false);

  useEffect(() => {
    const element = ref.current!;

    const checkOverflow = () => {
      setIsOverflown(
        element
          ? Math.abs(element.offsetWidth - element.scrollWidth) > 2 ||
              Math.abs(element.offsetHeight - element.scrollHeight) > 2
          : false
      );
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);

    return () => {
      window.removeEventListener("resize", checkOverflow);
    };
  }, []);

  return (
    <Tooltip
      isDisabled={!isOverflown}
      label={<Box whiteSpace="pre-wrap">{children}</Box>}
    >
      <Box
        ref={ref}
        width="full"
        height="full"
        whiteSpace="normal"
        noOfLines={7}
        {...props}
      >
        {children}
      </Box>
    </Tooltip>
  );
}
