import type { SVGProps } from "react";

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      width={28}
      height={28}
      viewBox="0 0 28 28"
      {...props}
    >
      <path
        stroke="#000"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .586 1.414"
      ></path>
      <path
        stroke="#000"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M17 6h-7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V13z"
      ></path>
      <path
        stroke="#000"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M17 6v7h7"
      ></path>
    </svg>
  );
}
