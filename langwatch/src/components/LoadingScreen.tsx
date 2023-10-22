import { Box, Fade } from "@chakra-ui/react";
import { FullLogo } from "./icons/FullLogo";
import { useEffect, useState } from "react";

export const LoadingScreen = () => {
  const [showLogo, setShowLogo] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setShowLogo(true);
    }, 50);
  }, []);

  return (
    <Box
      width="full"
      height="full"
      minHeight="100vh"
      backgroundColor="gray.300"
      paddingBottom={16}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <Fade in={showLogo}>
        <FullLogo />
      </Fade>
    </Box>
  );
};
