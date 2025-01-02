import { Box, Fade } from "@chakra-ui/react";
import { FullLogo } from "./icons/FullLogo";
import { useEffect, useState } from "react";

let logoVisibleOnce = false;

export const LoadingScreen = () => {
  const [showLogo, setShowLogo] = useState(logoVisibleOnce);

  useEffect(() => {
    setTimeout(() => {
      setShowLogo(true);
      setTimeout(() => {
        logoVisibleOnce = true;
      }, 500);
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
      {!logoVisibleOnce ? (
        <Fade in={showLogo}>
          <FullLogo />
        </Fade>
      ) : (
        <FullLogo />
      )}
    </Box>
  );
};
