/// <reference types="vite/client" />

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.scss" {
  const content: string;
  export default content;
}
