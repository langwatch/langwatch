import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { type AppType } from "next/app";

import { api } from "~/utils/api";

import {
  ChakraProvider,
  defineStyleConfig,
  type StyleFunctionProps,
} from "@chakra-ui/react";
import "~/styles/globals.scss";

import { extendTheme } from "@chakra-ui/react";
import debounce from "lodash.debounce";
import { Inter } from "next/font/google";
import Head from "next/head";
import { useRouter } from "next/router";
import NProgress from "nprogress";
import { useEffect } from "react";
//@ts-ignore
import _dependencies from "@injected-dependencies";
import { type Dependencies } from "../injection";

const inter = Inter({ subsets: ["latin"] });
const dependencies = _dependencies as Dependencies;

export const theme = extendTheme({
  styles: {
    global: (_props: StyleFunctionProps) => ({
      body: {
        background: "#E5E7EB",
      },
    }),
  },
  fonts: {
    heading: inter.style.fontFamily,
    body: inter.style.fontFamily,
  },
  colors: {
    gray: {
      800: "#090F1D",
      700: "#1F2937",
      600: "#213B41",
      500: "#51676C",
      400: "#9CA3AF",
      300: "#E5E7EB",
      200: "#F2F4F8",
      100: "#F7FAFC",
    },
    orange: {
      400: "#ED8926",
      300: "#FF9E2C",
      200: "#FFD19B",
      100: "#FFF3E4",
    },
  },
  components: {
    Card: defineStyleConfig({
      baseStyle: {
        container: {
          boxShadow: "0px 4px 10px 0px rgba(0, 0, 0, 0.06)",
        },
      },
    }),
    Tag: defineStyleConfig({
      baseStyle: {
        container: {
          borderRadius: "62px",
          paddingX: 4,
        },
      },
    }),
  },
});

const LangWatch: AppType<{
  session: Session | null;
  injected?: string | undefined;
}> = ({ Component, pageProps: { session, ...pageProps } }) => {
  const router = useRouter();

  useEffect(() => {
    NProgress.configure({ showSpinner: false });
    const handleChangeStart = debounce(() => NProgress.start(), 200);
    const handleChangeDone = () => {
      handleChangeStart.cancel();
      NProgress.done();
      setTimeout(() => NProgress.done(), 200);
    };

    router.events.on("routeChangeStart", handleChangeStart);
    router.events.on("routeChangeComplete", handleChangeDone);
    router.events.on("routeChangeError", handleChangeDone);

    return () => {
      router.events.off("routeChangeStart", handleChangeStart);
      router.events.off("routeChangeComplete", handleChangeDone);
      router.events.off("routeChangeError", handleChangeDone);
    };
  }, [router]);

  return (
    <SessionProvider
      session={session}
      refetchInterval={5 * 60}
      refetchOnWindowFocus={false}
    >
      <ChakraProvider theme={theme}>
        <Head>
          <title>LangWatch</title>
          <link
            rel="stylesheet"
            href="https://cdnjs.cloudflare.com/ajax/libs/nprogress/0.2.0/nprogress.min.css"
          />
        </Head>
        <Component {...pageProps} />
      </ChakraProvider>
    </SessionProvider>
  );
};

export default api.withTRPC(LangWatch);
