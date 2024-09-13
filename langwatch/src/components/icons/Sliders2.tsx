export function Sliders2({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        stroke="#000"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M6 9a3 3 0 100-6 3 3 0 000 6zM6 9v12M18 15a3 3 0 100 6 3 3 0 000-6zM18 15V3"
      ></path>
    </svg>
  );
}
