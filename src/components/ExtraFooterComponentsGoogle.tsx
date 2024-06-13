import Script from "next/script";

export function ExtraFooterComponentsScripts() {
  return (
    <>
      <Script
        async
        src="https://www.googletagmanager.com/gtag/js?id=G-0VEKZY9DMY"
      ></Script>
      <Script id="google-analytics">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-0VEKZY9DMY');
        `}
      </Script>
      <Script id="crisp">
        {`window.$crisp=[];window.CRISP_WEBSITE_ID="cca9eacd-c4d6-4258-a7fc-9606be6fd012";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
      </Script>
    </>
  );
}
