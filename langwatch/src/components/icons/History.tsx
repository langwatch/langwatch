export function HistoryIcon({ size = 24 }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      viewBox="0 0 22 22"
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M3.51 14A9 9 0 005 16.668M7.012 18.5A9 9 0 105.64 4.64L1 9M7.012 18.5A8.997 8.997 0 015 16.668M7.012 18.5L5 16.668"
      ></path>
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M12 5v6l4 2M1 3v6h6"
      ></path>
    </svg>
  );
}
